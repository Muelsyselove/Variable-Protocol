// 行动线：常规模式（节点条+二级界面）/ 小窗模式（常规小窗或桌宠模式，节点间自动流转）
import { show, registerScreen, onScreenCleanup } from '../../router.js'
import { nodeAt, runMaxHp, operatorOf, weaponOf } from '../../core/run.js'
import { TRANSLATORS } from '../../data/translators.js'
import { ALL_DICE } from '../../data/diceDefs.js'
import { translatorImg } from '../../data/images.js'
import { renderDieSnapshot } from '../../render/diceModels.js'
import { activePet, petSatiety, FOOD_SATIETY, chibiFor, computePetState, PET_STATE_NAMES } from '../../data/pets.js'
import { G, saveRun, saveProfile, protocolName, applyWindowState, decayPetSatiety } from '../../state.js'
import { setPetMode, petModeActive } from '../../core/petBridge.js'
import { el, fmt, bindTip, dieTip, openProtocolPicker } from '../components.js'
import { playSfx } from '../../core/sfx.js'

export function register() {
  registerScreen('map', renderMap)
}

const NODE_META = {
  BATTLE: { icon: '⚔', label: '普通战斗', cls: 'node-battle' },
  BOSS: { icon: '☠', label: 'BOSS战斗', cls: 'node-boss' },
  EVENT: { icon: '◈', label: '特殊事件', cls: 'node-event' },
  SHOP: { icon: '⌬', label: '通量转换', cls: 'node-shop' },
  REWARD: { icon: '✦', label: '奖励关', cls: 'node-reward' }
}

const BASE_DIE_NAMES = { attack: '攻击骰', barrier: '屏障骰', heal: '治疗骰' }

// 进入指定节点屏幕
function enterNode(type) {
  if (type === 'BATTLE' || type === 'BOSS') show('combat')
  else if (type === 'SHOP') show('shop')
  else if (type === 'EVENT') show('event')
  else if (type === 'REWARD') show('reward')
}

function renderMap(root) {
  const run = G.run
  // settings 兜底（旧存档反序列化已处理，此处双保险）
  run.settings = { speed: 1, protocol: 'none', animSkip: false, mini: false, alwaysOnTop: false, ...(run.settings || {}) }
  const protocol = run.settings.protocol
  const mini = !!run.settings.mini
  const op = operatorOf(run)
  const wpn = weaponOf(run)
  const maxHp = runMaxHp(run)
  const nextType = nodeAt(run.layer)
  // 局内当前攻击力（干员+武器+局内加成），供骰子数值展示
  const runAtk = Math.floor((op.atk + weaponOf(run).atk) * (1 + run.atkBonus) * (1 + run.permAtkBonus))

  // 小窗模式：常规小窗（信息中枢）/ 桌宠模式（透明悬浮窗，主窗口隐藏游戏后台运行）
  if (mini) {
    if (G.profile.miniStyle === 'pet') return enterPetMode(root, run)
    return renderMiniHub(root, { run, op, maxHp, nextType, protocol })
  }

  // ════ 常规模式 ════
  const cont = el(`
  <div class="screen screen-map">
    <div class="map-head panel">
      <div class="map-id">
        <div class="op-name">${op.name}<span class="op-title"> · ${op.title}</span></div>
        <div class="op-wpn">${wpn.name}</div>
      </div>
      <div class="map-hp">
        <div class="hpbar"><div class="hpfill" style="width:${Math.min(100, run.hp / maxHp * 100)}%"></div></div>
        <div class="hptext">${fmt(run.hp)} / ${fmt(maxHp)}</div>
      </div>
      <div class="map-flux">⌾ <b>${fmt(run.flux)}</b><span class="unit">通量</span></div>
      <div class="map-layer">第 <b>${run.layer}</b> 层</div>
      <div class="map-head-btns">
        <button class="btn btn-mini" id="btn-save">中断保存</button>
        <button class="btn btn-mini" id="btn-settings">系统设置</button>
        <button class="btn btn-mini btn-ghost" id="btn-menu">保存并返回首页</button>
      </div>
    </div>

    <div class="map-line panel">
      <div class="line-label">// 行动线 ACTION LINE</div>
      <div class="nodes" id="nodes"></div>
      <div class="line-actions">
        <button class="btn btn-mini" id="btn-view-inv">◆ 转译器</button>
        <button class="btn btn-mini" id="btn-view-bag">◆ 骰子背包</button>
        <button class="btn btn-mini" id="btn-view-me">◆ 个人信息</button>
        <div class="flex-sp"></div>
        <button class="btn btn-mini" id="btn-anim">动画：${run.settings.animSkip ? '关' : '开'}</button>
        <button class="btn btn-mini ${protocol !== 'none' ? 'btn-warn' : ''}" id="btn-auto">协议：${protocol !== 'none' ? protocolName(protocol) : '未启用'}</button>
        <button class="btn btn-mini" id="btn-mini">小窗模式</button>
        <button class="btn btn-primary" id="btn-go">进入 · ${NODE_META[nextType].label}</button>
      </div>
      <div class="map-auto-hint" id="auto-hint"></div>
    </div>

    <div class="overlay" id="view" style="display:none"></div>
  </div>`)
  root.appendChild(cont)

  // ── 节点条：当前循环段 + 下一段预览 ──
  const nodesEl = cont.querySelector('#nodes')
  const cycleStart = Math.floor((run.layer - 1) / 5) * 5 + 1
  const layers = []
  for (let L = cycleStart; L < cycleStart + 5; L++) layers.push(L)
  for (let L = cycleStart + 5; L < cycleStart + 8 && L <= cycleStart + 10; L++) layers.push(L)
  layers.forEach((L) => {
    const meta = NODE_META[nodeAt(L)]
    const isCurrent = L === run.layer
    const isPast = L < run.layer
    const node = el(`
      <div class="node ${meta.cls} ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}">
        <div class="node-icon">${meta.icon}</div>
        <div class="node-label">${meta.label}</div>
        <div class="node-layer">L${L}</div>
      </div>`)
    if (!isPast) bindTip(node, `第 ${L} 层 · ${meta.label}`)
    nodesEl.appendChild(node)
  })

  // ── 节点进入 ──
  cont.querySelector('#btn-go').onclick = () => enterNode(nextType)

  // ── 中断保存 / 系统设置 / 保存并返回首页 ──
  cont.querySelector('#btn-save').onclick = async () => {
    await saveRun()
    const b = cont.querySelector('#btn-save')
    b.textContent = '已保存 ✓'
    setTimeout(() => { b.textContent = '中断保存' }, 1000)
  }
  cont.querySelector('#btn-settings').onclick = () => show('settings', { from: 'map' })
  cont.querySelector('#btn-menu').onclick = async () => {
    await saveRun()
    show('menu')
  }

  // ── 自动协议：自动进入所有节点（决策节点进入后等待玩家操作） ──
  const hintEl = cont.querySelector('#auto-hint')
  let autoTimer = null
  if (protocol !== 'none') {
    hintEl.textContent = `${protocolName(protocol)}运行中 · 即将进入${NODE_META[nextType].label}（底部协议栏可终止或切换）`
    autoTimer = setTimeout(() => {
      if (G.run === run && run.settings.protocol !== 'none') enterNode(nextType)
    }, 1500)
  }
  onScreenCleanup(() => { if (autoTimer) clearTimeout(autoTimer) })

  // ── 协议选择器（全局悬浮层，可随时切换） ──
  const viewEl = cont.querySelector('#view')
  cont.querySelector('#btn-auto').onclick = () => openProtocolPicker()

  // ── 跳过动画开关 ──
  cont.querySelector('#btn-anim').onclick = async () => {
    run.settings.animSkip = !run.settings.animSkip
    await saveRun()
    show('map')
  }

  // ── 小窗模式 ──
  cont.querySelector('#btn-mini').onclick = async () => {
    run.settings.mini = true
    if (run.settings.protocol === 'none') run.settings.protocol = 'auto'
    applyWindowState()
    await saveRun()
    show('map')
  }
  applyWindowState()

  // ── 二级界面（转译器/骰子背包/个人信息） ──
  cont.querySelector('#btn-view-inv').onclick = () => openView('inv')
  cont.querySelector('#btn-view-bag').onclick = () => openView('bag')
  cont.querySelector('#btn-view-me').onclick = () => openView('me')

  function openView(kind) {
    viewEl.style.display = 'flex'
    const body = kind === 'inv' ? viewInv() : kind === 'bag' ? viewBag() : viewMe()
    viewEl.innerHTML = `
      <div class="overlay-panel map-view-panel">
        ${body}
        <div class="view-foot"><button class="btn btn-mini" id="btn-view-close">关闭</button></div>
      </div>`
    viewEl.querySelector('#btn-view-close').onclick = () => { viewEl.style.display = 'none' }
    // 骰子提示
    viewEl.querySelectorAll('[data-die]').forEach((c) => bindTip(c, () => dieTip(c.dataset.die, runAtk)))
    // 转译器提示与交互
    viewEl.querySelectorAll('[data-inv]').forEach((c) => {
      const def = TRANSLATORS[c.dataset.inv]
      const stacks = Number(c.dataset.stacks) || 1
      const slotted = def.tier === 'core' && run.coreSlots.includes(def.id)
      bindTip(c, `<b>${def.name}${stacks > 1 ? ` ×${stacks}` : ''}</b>${def.tier === 'high' ? '（高阶）' : def.tier === 'core' ? '（核心' + (slotted ? '·已入槽' : '·未入槽') + '）' : ''}<br>${def.desc}`)
      // 未入槽的核心转译器：点击装入空槽
      if (def.tier === 'core' && !slotted) {
        c.classList.add('clickable')
        c.onclick = () => {
          const empty = run.coreSlots.indexOf(null)
          if (empty >= 0) run.coreSlots[empty] = def.id
          openView('inv')
        }
      }
    })
    // 核心槽：点击卸下
    viewEl.querySelectorAll('.core-slot.filled').forEach((slot) => {
      slot.onclick = () => {
        run.coreSlots[Number(slot.dataset.slot)] = null
        openView('inv')
      }
    })
    // 骰子3D模型快照：分帧生成，避免阻塞（WebGL不可用时静默忽略）
    const snaps = viewEl.querySelectorAll('[data-snap]')
    let si = 0
    const snapStep = () => {
      if (si >= snaps.length) return
      const img = snaps[si++]
      const def = ALL_DICE[img.dataset.snap]
      try {
        if (def) img.src = renderDieSnapshot({ defId: def.id, pips: def.pips ?? 6, kinds: def.kinds })
      } catch { /* 忽略 */ }
      setTimeout(snapStep, 16)
    }
    setTimeout(snapStep, 0)
  }

  // 转译器视图
  function viewInv() {
    const slots = run.coreSlots.map((id, i) => {
      const def = id ? TRANSLATORS[id] : null
      const img = def ? translatorImg(id) : null
      return `<div class="core-slot ${def ? 'filled' : ''}" data-slot="${i}">${def ? `${img ? `<img class="chip-img" src="${img}" alt="${def.name}"/>` : ''}<span class="core-star">★</span>${def.name}` : `核心槽 ${i + 1}`}</div>`
    }).join('')
    const chips = run.translators.map((t) => {
      const def = TRANSLATORS[t.id]
      if (!def) return ''
      const slotted = def.tier === 'core' && run.coreSlots.includes(t.id)
      const img = translatorImg(t.id)
      return `<span class="t-chip ${def.tier} ${slotted ? 'slotted' : ''}" data-inv="${t.id}" data-stacks="${t.stacks}">${img ? `<img class="chip-img" src="${img}" alt="${def.name}"/>` : ''}${def.name}${t.stacks > 1 ? ` ×${t.stacks}` : ''}${def.tier === 'core' ? (slotted ? ' ★' : ' ◇') : ''}</span>`
    }).join('') || '<span class="dim">尚未持有转译器</span>'
    return `
      <div class="view-title">// 转译器</div>
      <div class="view-section">
        <div class="view-label">核心槽（点击已入槽的核心卸下 · 点击带◇的核心装入）</div>
        <div class="core-slots">${slots}</div>
      </div>
      <div class="view-section">
        <div class="view-label">持有清单（悬停查看效果）</div>
        <div class="inv-list">${chips}</div>
      </div>`
  }

  // 骰子背包视图
  function viewBag() {
    const baseCounts = {}
    for (const [kind, n] of Object.entries(wpn.dice)) baseCounts[kind] = (baseCounts[kind] || 0) + n
    const baseChips = Object.entries(baseCounts).map(([id, n]) =>
      `<span class="die-chip" data-die="${id}"><img class="die-chip-img" data-snap="${id}" alt=""/>${BASE_DIE_NAMES[id] || id}×${n}</span>`).join('')
    const specialCounts = {}
    for (const id of [...wpn.special, ...run.extraDice]) specialCounts[id] = (specialCounts[id] || 0) + 1
    const specialChips = Object.entries(specialCounts).map(([id, n]) => {
      const def = ALL_DICE[id]
      return `<span class="die-chip die-chip-special" data-die="${id}"><img class="die-chip-img" data-snap="${id}" alt=""/>${def ? def.name : id}${def?.pips ? `(${def.pips}点)` : ''}×${n}</span>`
    }).join('')
    const total = Object.values(baseCounts).reduce((a, b) => a + b, 0) + Object.keys(specialCounts).reduce((a, id) => a + specialCounts[id], 0)
    return `
      <div class="view-title">// 骰子背包</div>
      <div class="view-section">
        <div class="view-label">武器初始骰（${wpn.name}）</div>
        <div class="dice-chips">${baseChips || '<span class="dim">无</span>'}</div>
      </div>
      <div class="view-section">
        <div class="view-label">特殊骰（武器自带与局内获得）</div>
        <div class="dice-chips">${specialChips || '<span class="dim">无</span>'}</div>
      </div>
      <div class="view-note dim">合计 ${total} 颗 · 骰池上限 ${10 + (run.poolCapBonus || 0)} 颗 · 基础骰点数每场战斗随机分配 · 悬停查看骰子效果</div>`
  }

  // 个人信息视图
  function viewMe() {
    const atk = Math.floor((op.atk + wpn.atk) * (1 + run.atkBonus))
    const permPct = (run.permAtkBonus * 100).toFixed(0)
    const rows = [
      ['干员', `${op.name} · ${op.title}`],
      ['武器', wpn.name],
      ['生命', `${fmt(run.hp)} / ${fmt(maxHp)}${run.maxHpMult !== 1 ? `（上限倍率×${run.maxHpMult.toFixed(2)}）` : ''}`],
      ['攻击', `${fmt(atk)}${run.permAtkBonus > 0 ? `（快速迭代 +${permPct}%）` : ''}`],
      ['通量', fmt(run.flux)],
      ['当前层数', run.layer],
      ['清除虚质', run.stats.kills],
      ['干员能力', op.desc],
      ['武器效果', wpn.desc]
    ]
    return `<div class="view-title">// 个人信息</div>` +
      rows.map(([k, v]) => `<div class="detail-row"><span class="k">${k}</span><span>${v}</span></div>`).join('')
  }
}

// ════ 桌宠模式：主窗口隐藏，游戏后台运行，桌宠以透明悬浮窗呈现 ════
function enterPetMode(root, run) {
  const nextType = nodeAt(run.layer)
  // 桌宠模式协议升级：仅允许自动代理/智慧代理（决策节点需无人值守推进；
  // 自动协议/未启用会在事件、商店、奖励关等待手动操作，隐藏窗口下永远卡住）
  if (run.settings.protocol !== 'agent' && run.settings.protocol !== 'smart') {
    run.settings.protocol = 'agent'
    void saveRun()
  }
  // 主窗口即将隐藏，渲染空屏占位；游戏逻辑（自动协议流转）在本窗口后台继续执行
  root.appendChild(el('<div class="screen screen-map"></div>'))
  setPetMode(true)
  if (typeof window !== 'undefined' && window.api) window.api.petOpen()
  // 后台自动推进：与常规小窗一致，短暂停留后进入下一节点；
  // 战斗结束 show('map') 会重新走到这里，形成完整的后台流转循环
  const hubTimer = setTimeout(() => {
    if (G.run === run && run.settings.mini && petModeActive()) enterNode(nextType)
  }, 1200)
  onScreenCleanup(() => clearTimeout(hubTimer))
}

// ════ 小窗模式：常规小窗信息中枢（桌宠模式由透明悬浮窗承担，见 enterPetMode） ════
function renderMiniHub(root, args) {
  return renderHubMode(root, args)
}

// ── 小窗·常规小窗：信息中枢 ──
function renderHubMode(root, { run, op, maxHp, nextType, protocol }) {
  // 桌宠状态（饱食度随时间衰减后计算：战后闪光 > 饱食度分层）
  decayPetSatiety()
  const prof = G.profile
  const pet = activePet(prof)
  const petSat = pet ? petSatiety(prof, pet.id) : 0
  const petState = pet ? computePetState(prof, 'map') : 'normal'
  const petHungry = petSat <= 15
  const quote = pet
    ? (petSat <= 0 ? pet.quotes.dizziness : petSat <= 15 ? pet.quotes.cry : run.layer % 2 === 0 ? pet.quotes.battle : pet.quotes.idle)
    : null

  const cont = el(`
  <div class="screen screen-map mini-hub">
    <div class="mh-head panel">
      <div class="mh-line1">
        <span class="mh-name">${op.name}</span>
        <span class="mh-layer">L${run.layer}</span>
        <span class="mh-flux">⌾ ${fmt(run.flux)}</span>
      </div>
      <div class="hpbar"><div class="hpfill" style="width:${Math.min(100, run.hp / maxHp * 100)}%"></div></div>
      <div class="hptext">${fmt(run.hp)} / ${fmt(maxHp)}</div>
    </div>
    <div class="mh-status">● 正在推进 · ${NODE_META[nextType].label}（第 ${run.layer} 层）</div>
    <div class="mh-pet-panel ${pet ? '' : 'none'} ${petHungry ? 'hungry' : ''}" id="mh-pet">
      ${pet ? `
      <div class="mh-pet-img" title="${PET_STATE_NAMES[petState] || ''}"><img src="${chibiFor(pet, petState)}" alt="${pet.name}"/></div>
      <div class="mh-pet-info">
        <div class="mh-pet-name">${pet.name}<span class="mh-pet-quote">${quote ? `「${quote[Math.floor(Math.random() * quote.length)]}」` : ''}</span></div>
        <div class="mh-pet-sat"><div class="mh-pet-sat-fill" style="width:${Math.min(100, petSat)}%"></div></div>
        <div class="mh-pet-sat-text">饱食度 ${Math.min(100, petSat)}/100 · 口粮 ×${prof.pet.food}${petHungry ? ' · 想吃口粮了' : ''}</div>
      </div>
      <button class="btn btn-mini mh-pet-feed" id="btn-pet-feed" ${prof.pet.food <= 0 || petSat >= 100 ? 'disabled' : ''}>喂食</button>`
      : '<span class="dim">桌宠模式：前往主菜单「桌宠终端」获取伙伴</span>'}
    </div>
    <div class="mh-actions">
      <button class="btn btn-mini" id="btn-auto">协议：${protocol !== 'none' ? protocolName(protocol) : '未启用'}</button>
      <button class="btn btn-mini" id="btn-settings">设置</button>
      <button class="btn btn-mini btn-warn" id="btn-mini-exit">退出小窗</button>
    </div>
  </div>`)
  root.appendChild(cont)
  applyWindowState()
  bindMiniCommon(cont, { run, prof, pet, nextType })
}

// ── 小窗公共逻辑：喂食 / 自动流转 / 协议选择 / 设置 / 退出 ──
function bindMiniCommon(cont, { run, prof, pet, nextType }) {
  // 喂食按钮
  const feedBtn = cont.querySelector('#btn-pet-feed')
  if (feedBtn && pet) {
    feedBtn.onclick = async () => {
      const cur = petSatiety(prof, pet.id)
      if (prof.pet.food <= 0 || cur >= 100) { playSfx('error'); return }
      prof.pet.food -= 1
      prof.pet.satiety[pet.id] = Math.min(100, cur + FOOD_SATIETY)
      playSfx('eat')
      await saveProfile()
      show('map')
    }
  }

  // 节点自动流转：短暂停留后进入下一节点（战斗/事件/商店/奖励均自动进入；
  // 决策节点进入后等待玩家操作，操作完成返回中枢再次自动推进）；
  // 协议终止后不再自动流转（与大屏行为一致，玩家可手动点击进入）
  const hubTimer = setTimeout(() => {
    if (G.run === run && run.settings.mini && run.settings.protocol !== 'none') enterNode(nextType)
  }, 1200)
  onScreenCleanup(() => clearTimeout(hubTimer))

  // 协议选择器（全局悬浮层）
  cont.querySelector('#btn-auto').onclick = () => openProtocolPicker()

  // 系统设置（局内保留）
  cont.querySelector('#btn-settings').onclick = () => show('settings', { from: 'map' })

  // 退出小窗
  cont.querySelector('#btn-mini-exit').onclick = async () => {
    run.settings.mini = false
    run.settings.alwaysOnTop = false
    applyWindowState()
    await saveRun()
    show('map')
  }
}
