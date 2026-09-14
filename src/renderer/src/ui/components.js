// 共享UI组件：HTML构建、血条、状态徽章、日志行、浮动数字、提示框
import { ALL_DICE } from '../data/diceDefs.js'
import { G, PROTOCOLS, saveRun } from '../state.js'

export function el(html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html.trim()
  return tpl.content.firstElementChild
}

export function fmt(n) {
  return Math.floor(n).toLocaleString('en-US')
}

// 生命条
export function hpBarHtml(cls, label) {
  return `
  <div class="hpwrap ${cls}">
    <div class="hpname">${label}</div>
    <div class="hpbar"><div class="hpfill"></div></div>
    <div class="hptext"><span class="cur">0</span> / <span class="max">0</span></div>
  </div>`
}

export function updateHpBar(root, unit) {
  const wrap = root.querySelector('.hpwrap')
  if (!wrap || !unit) return
  const max = unit.attrs.hp
  const cur = Math.max(0, unit.hp)
  const pct = Math.max(0, Math.min(100, (cur / max) * 100))
  wrap.querySelector('.hpfill').style.width = pct + '%'
  wrap.querySelector('.cur').textContent = fmt(cur)
  wrap.querySelector('.max').textContent = fmt(max)
  wrap.classList.toggle('low', pct < 30)
}

// 状态徽章：护盾（次数）/屏障（数值）/麻痹/崩溃/心理损伤
export function statusChips(unit) {
  if (!unit) return ''
  const chips = []
  if (unit.shieldLayers > 0) chips.push(`<span class="chip chip-shield">护盾 ×${unit.shieldLayers}</span>`)
  if (unit.barrier > 0) chips.push(`<span class="chip chip-shield">屏障 ${fmt(unit.barrier)}</span>`)
  if (unit.paralysis > 0) chips.push(`<span class="chip chip-para">麻痹 ×${unit.paralysis}</span>`)
  if (unit.crash) chips.push(`<span class="chip chip-crash">${crashName(unit.crash.type)} ${unit.crash.turns}回合</span>`)
  if (unit.psychicPool > 0) {
    chips.push(`<span class="chip chip-psy">心理 ${fmt(unit.psychicPool)}/${fmt(unit.attrs.maxPsy)}</span>`)
  }
  if (unit.fragile > 0) chips.push(`<span class="chip chip-frag">脆弱 +${Math.round(unit.fragile * 100)}%</span>`)
  return chips.join('')
}

export function crashName(type) {
  return { gloom: '沉沦崩溃', chaos: '混沌崩溃', ruin: '破灭崩溃', overload: '过载崩溃' }[type] || '崩溃'
}

// 日志行
export function logLine(ev) {
  const map = {
    turn: { text: `—— 第 ${ev.turn} 回合 ——`, cls: 'log-turn' },
    draw: { text: `${sideName(ev.side)}抽出 ${ev.pips} 点 · ${dieName(ev.name)}`, cls: 'log-draw' },
    reroll: { text: `${sideName(ev.side)}重抽（${ev.source}）→ ${ev.pips ?? '?'} 点`, cls: 'log-draw' },
    tieReroll: { text: '点数相同，双方重掷', cls: 'log-sys' },
    order: { text: ev.reason === 'paralysis' ? `${sideName(ev.first)}先行（对方麻痹）` : `先手：${sideName(ev.first)}（${ev.ap} vs ${ev.ep}）`, cls: 'log-sys' },
    damage: { text: `${sideName(ev.side)}受到 ${fmt(ev.amount)} ${typeName(ev.dtype)}${ev.blocked ? `（抵挡${fmt(ev.blocked)}）` : ''}`, cls: 'log-dmg' },
    damageZero: { text: `${sideName(ev.side)}${ev.label}，伤害归零`, cls: 'log-block' },
    heal: { text: `${sideName(ev.side)}恢复 ${fmt(ev.amount)} 生命${ev.overflow ? `（溢出${fmt(ev.overflow)}）` : ''}`, cls: 'log-heal' },
    shieldLayerGain: { text: `${sideName(ev.side)}获得 ${ev.count} 层护盾（共×${ev.layers}）`, cls: 'log-shield' },
    shieldBlock: { text: `${sideName(ev.side)}护盾抵挡（剩余×${ev.layers}）`, cls: 'log-block' },
    psychic: { text: `${sideName(ev.side)}累计 ${fmt(ev.amount)} 心理损伤（${fmt(ev.pool)}/${fmt(ev.max)}）`, cls: 'log-psy' },
    psychicBlocked: { text: `${sideName(ev.side)}崩溃期间无法累计心理损伤`, cls: 'log-psy' },
    crash: { text: `${sideName(ev.side)}触发【${ev.name}】！`, cls: 'log-crash' },
    crashEnd: { text: `${sideName(ev.side)}的${ev.name}结束`, cls: 'log-sys' },
    paralysis: { text: `${sideName(ev.side)}获得麻痹 ×${ev.layers}`, cls: 'log-para' },
    paralyzed: { text: `${sideName(ev.side)}麻痹，跳过本回合`, cls: 'log-para' },
    barrierGain: { text: `${sideName(ev.side)}获得 ${fmt(ev.value)} 屏障`, cls: 'log-shield' },
    modExpire: { text: `${sideName(ev.side)}的${ev.label}结束`, cls: 'log-sys' },
    tempDieExpire: { text: `${sideName(ev.side)}的临时骰子消失`, cls: 'log-sys' },
    dieAdded: { text: `${sideName(ev.side)}骰池加入 ${ev.pips} 点·${dieName(ev.name)}`, cls: 'log-sys' },
    dieAddFail: { text: `${sideName(ev.side)}骰池已满，${dieName(ev.name)}加入失败`, cls: 'log-sys' },
    transpose: { text: `${sideName(ev.side)}的转置骰交换了点数 → ${ev.pips}点`, cls: 'log-sys' },
    dispel: { text: `${sideName(ev.side)}被驱散了 ${ev.removed} 个增益效果`, cls: 'log-debuff' },
    buff: { text: `${sideName(ev.side)}：${ev.label}`, cls: 'log-buff' },
    debuff: { text: `${sideName(ev.side)}：${ev.label}`, cls: 'log-debuff' },
    judgeProc: { text: `${ev.label}`, cls: 'log-sys' },
    cleanse: { text: `${sideName(ev.side)}净化了 ${ev.removed} 个负面效果`, cls: 'log-buff' },
    action: { text: `${sideName(ev.side)}行动：${ev.pips}点·${dieName(ev.die)}`, cls: 'log-act' },
    skip: { text: `${sideName(ev.side)}跳过行动`, cls: 'log-sys' },
    revive: { text: '应急熔断触发，成功复活！', cls: 'log-heal' },
    info: { text: ev.text, cls: 'log-sys' },
    stalemate: { text: '消耗战僵局已达上限，判定干员获胜', cls: 'log-win' },
    victory: { text: '目标清除，战斗胜利', cls: 'log-win' },
    defeat: { text: '连接中断……战斗失败', cls: 'log-lose' }
  }
  const m = map[ev.type]
  if (!m) return null
  return `<div class="logline ${m.cls}">${m.text}</div>`
}

function sideName(side) {
  return side === 'ally' ? '干员' : '虚质'
}

function typeName(t) {
  return { PHYSICAL: '物理伤害', MAGIC: '法术伤害', PSYCHIC: '心理伤害', TRUE: '真实伤害', HEAL: '治疗' }[t] || '伤害'
}

const DIE_NAMES = {
  attack: '攻击骰', barrier: '屏障骰', heal: '治疗骰',
  interference: '干涉骰', erosion: '侵蚀骰', verify: '校验骰', assault: '强袭骰',
  overlap: '重叠骰', gloomDie: '沉沦骰', chaosDie: '混沌骰', ruinDie: '破灭骰',
  overloadDie: '过载骰', purify: '净化骰', pure1: '1点骰',
  shieldDie: '护盾骰', bastionDie: '棱堡骰', repairDie: '修复骰', regenDie: '再生骰',
  firstAidDie: '急救骰', sentryDie: '哨岗骰',
  magicDie: '法能骰', pierceDie: '穿透骰', sunderDie: '破甲骰', trueStrikeDie: '真伤骰',
  executeDie: '处决骰', chainDie: '链式骰', leechDie: '吸血骰', spikeDie: '尖峰骰',
  unstableDie: '不稳骰', freezeDie: '定身骰', frailDie: '脆弱骰', vulnDie: '裂伤骰',
  dispelDie: '驱散骰', floodDie: '洪泛骰',
  mindBurstDie: '心爆骰', twinMindDie: '双相骰', dreadDie: '惊惧骰',
  cacheDie: '缓存骰', duplicateDie: '复刻骰', vanguardDie: '先导骰', bountyDie: '赏金骰',
  shieldSurgeDie: '盾涌骰', hemoBarrierDie: '凝血盾骰', parryDie: '格挡骰',
  mindDrainDie: '心蚀骰', hallucinationDie: '幻痛骰', psycheVeilDie: '心幕骰',
  vengeanceDie: '复仇骰', desperateDie: '亡命骰', scrapDie: '废料骰',
  transposeDie: '转置骰', jackpotDie: '头奖骰', cometDie: '彗星骰',
  manaVeilDie: '魔幕骰', gatlingDie: '弹幕骰'
}
export function dieName(id) {
  return DIE_NAMES[id] || id
}

// 浮动数字
export function floatNumber(panel, text, cls) {
  const f = el(`<div class="floatnum ${cls}">${text}</div>`)
  panel.appendChild(f)
  setTimeout(() => f.remove(), 1100)
}

// 提示框（全局单例；支持悬停模式与点击钉住模式）
let tipEl = null
export function initTooltip() {
  if (tipEl) return
  tipEl = el('<div class="tooltip"></div>')
  document.body.appendChild(tipEl)
  document.addEventListener('mousemove', (e) => {
    if (tipEl.style.display === 'block' && tipEl.dataset.mode !== 'pinned') {
      tipEl.style.left = Math.min(window.innerWidth - 320, e.clientX + 14) + 'px'
      tipEl.style.top = Math.min(window.innerHeight - 140, e.clientY + 14) + 'px'
    }
  })
  // 钉住模式下，点击画布以外的区域关闭提示
  document.addEventListener('pointerdown', (e) => {
    if (tipEl.dataset.mode === 'pinned' && !e.target.closest('canvas')) hideTip()
  })
}

export function bindTip(target, getText) {
  target.addEventListener('mouseenter', () => {
    tipEl.innerHTML = typeof getText === 'function' ? getText() : getText
    tipEl.dataset.mode = ''
    tipEl.style.display = 'block'
  })
  target.addEventListener('mouseleave', () => {
    if (tipEl.dataset.mode !== 'pinned') tipEl.style.display = 'none'
  })
}

// 点击位置显示（pinned=true 钉住直到点击空白处；pinned=false 跟随鼠标，用于悬停）
export function showTipAt(x, y, html, pinned = true) {
  initTooltip()
  tipEl.innerHTML = html
  tipEl.dataset.mode = pinned ? 'pinned' : ''
  tipEl.style.display = 'block'
  tipEl.style.left = Math.min(window.innerWidth - 330, x + 12) + 'px'
  tipEl.style.top = Math.min(window.innerHeight - 180, y + 12) + 'px'
}

export function hideTip() {
  if (tipEl) {
    tipEl.style.display = 'none'
    tipEl.dataset.mode = ''
  }
}

// 仅隐藏非钉住的悬停提示
export function hideTipIfTransient() {
  if (tipEl && tipEl.dataset.mode !== 'pinned') tipEl.style.display = 'none'
}

export function isTipPinned() {
  return !!tipEl && tipEl.dataset.mode === 'pinned'
}

// 骰子信息提示文本（按定义id；atk 可选——提供时展示具体数值与算法）
export function dieTip(id, atk) {
  const def = ALL_DICE[id]
  if (!def) return id
  const isBase = ['attack', 'barrier', 'heal'].includes(id)
  const lines = [`<b>${def.name}${def.pips ? ` · ${def.pips}点` : ''}</b>`]
  lines.push(def.desc)
  if (isBase) {
    lines.push('<span class="dim">点数1~6，每场战斗随机分配，效果数值随点数缩放</span>')
    if (atk != null && atk > 0) {
      // 各点数档位具体数值：效果 = 攻击力 × (0.5 + 点数/12)
      const table = [1, 2, 3, 4, 5, 6].map((p) => {
        const coef = 0.5 + p / 12
        return `<tr><td>${p}点</td><td>${(coef * 100).toFixed(1)}%</td><td>${fmt(atk * coef)}</td></tr>`
      }).join('')
      lines.push(`<table class="tip-table"><tr><th>点数</th><th>系数</th><th>数值</th></tr>${table}</table>`)
      lines.push('<span class="dim">效果 = 攻击力 × (0.5 + 点数/12)</span>')
    }
  } else if (id === 'overlap' && atk != null && atk > 0) {
    const coef = 0.5 + def.pips / 12
    lines.push(`本颗（${def.pips}点）：屏障 ${fmt(atk * coef)} / 治疗 ${fmt(atk * coef)}`)
  }
  // 特殊骰固定值效果补充数值
  if (id === 'gloomDie' || id === 'chaosDie' || id === 'ruinDie') {
    lines.push('<span class="dim">受敌方损伤抵抗影响（心理公式），崩溃需累计至其最大心理值</span>')
  } else if (id === 'overloadDie') {
    lines.push('<span class="dim">受敌方损伤抵抗影响；过载崩溃：2回合内每回合+1层麻痹（上限3层）</span>')
  }
  return lines.join('<br>')
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 账号掩码：只露前三位与后三位，中间用 * 替代（如 123*****456）
export function maskAccount(acc) {
  const s = String(acc || '')
  if (s.length <= 6) return s.replace(/.(?=.{3})/g, '*')
  return s.slice(0, 3) + '*'.repeat(s.length - 6) + s.slice(-3)
}

// ── 通用弹窗（终端风：角括号面板 + 遮罩；按钮/遮罩/ESC 关闭并回传按钮 value）──
// showDialog({ title, html, buttons: [{label, value, cls}], width }) → Promise<value|null>
// showConfirm(title, message) → Promise<boolean>（确定/取消）
export function showDialog({ title = '', html = '', buttons = [{ label: '确定', value: true, cls: 'btn-primary' }], width = 460 } = {}) {
  return new Promise((resolve) => {
    const overlay = el(`
    <div class="dlg-overlay">
      <div class="dlg panel" style="width:${width}px">
        ${title ? `<div class="dlg-title">${title}</div>` : ''}
        <div class="dlg-body">${html}</div>
        <div class="dlg-btns">
          ${buttons.map((b, i) => `<button class="btn btn-mini ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}
        </div>
      </div>
    </div>`)
    document.body.appendChild(overlay)
    const close = (v) => {
      window.removeEventListener('keydown', onKey)
      overlay.remove()
      resolve(v ?? null)
    }
    overlay.querySelectorAll('.dlg-btns .btn').forEach((btn) => {
      btn.onclick = () => close(buttons[Number(btn.dataset.i)]?.value)
    })
    overlay.onclick = (e) => { if (e.target === overlay) close(null) }
    const onKey = (e) => { if (e.key === 'Escape') close(null) }
    window.addEventListener('keydown', onKey)
    // 遮罩出现后按钮才可聚焦：默认聚焦第一个按钮（Enter 直接确认）
    overlay.querySelector('.dlg-btns .btn')?.focus()
  })
}

export function showConfirm(title, message, opts = {}) {
  return showDialog({
    title,
    html: `<div class="dlg-msg">${message}</div>`,
    width: opts.width || 420,
    buttons: [
      { label: opts.okLabel || '确定', value: true, cls: opts.danger ? 'btn-warn' : 'btn-primary' },
      { label: opts.cancelLabel || '取消', value: false, cls: '' }
    ]
  }).then((v) => v === true)
}

// ── 自动协议常驻栏（屏幕底部，协议运行期间显示） ──
// onTerminate：终止回调（由 router 注入，避免循环依赖）
let protocolBarEl = null
let protocolBarTerminate = null

export function setProtocolBarTerminate(fn) {
  protocolBarTerminate = fn
}

export function ensureProtocolBar() {
  if (protocolBarEl) return protocolBarEl
  protocolBarEl = el('<div id="protocol-bar" class="protocol-bar" style="display:none"></div>')
  document.body.appendChild(protocolBarEl)
  return protocolBarEl
}

// 更新协议栏显示（每次屏幕切换后调用）
export function updateProtocolBar(protocolId, protocolLabel) {
  ensureProtocolBar()
  if (!protocolId || protocolId === 'none') {
    protocolBarEl.style.display = 'none'
    return
  }
  protocolBarEl.style.display = 'flex'
  // 连战仅自动代理/智慧代理可用（需无人值守开局能力）
  const chainable = protocolId === 'agent' || protocolId === 'smart'
  const chainOn = G.profile.chainBattle
  protocolBarEl.innerHTML = `
    <span class="pb-status"><span class="pb-dot"></span>${protocolLabel}运行中</span>
    ${chainable ? `<button class="btn btn-mini pb-chain ${chainOn ? 'pb-chain-on' : ''}">连战：${chainOn ? '开' : '关'}</button>` : ''}
    <button class="btn btn-mini pb-switch">切换协议</button>
    <button class="btn btn-mini pb-stop">终止${protocolLabel}</button>`
  const chainBtn = protocolBarEl.querySelector('.pb-chain')
  if (chainBtn) {
    chainBtn.onclick = async () => {
      G.profile.chainBattle = !G.profile.chainBattle
      await saveProfile()
      updateProtocolBar(protocolId, protocolLabel)
    }
  }
  protocolBarEl.querySelector('.pb-switch').onclick = () => {
    openProtocolPicker()
  }
  protocolBarEl.querySelector('.pb-stop').onclick = () => {
    protocolBarTerminate?.()
  }
}

// ── 全局协议选择器（悬浮层，可从协议栏/行动线随时打开） ──
let protoPickerEl = null

export function openProtocolPicker() {
  const run = G.run
  if (!run?.settings) return
  if (!protoPickerEl) {
    protoPickerEl = el('<div id="proto-picker" class="proto-picker-overlay" style="display:none"></div>')
    document.body.appendChild(protoPickerEl)
  }
  const cards = PROTOCOLS.map((p) => {
    const active = run.settings.protocol === p.id
    const state = p.available
      ? (active ? '运行中 · 点击关闭' : '点击启用')
      : '即将推出'
    return `
      <div class="proto-card ${p.available ? '' : 'proto-disabled'} ${active ? 'proto-active' : ''}" data-proto="${p.id}">
        <div class="proto-name">${p.name}${active ? ' ●' : ''}</div>
        <div class="proto-desc">${p.desc}</div>
        <div class="proto-state">${state}</div>
      </div>`
  }).join('')
  protoPickerEl.innerHTML = `
    <div class="overlay-panel proto-panel panel">
      <div class="view-title">// 自动协议 · 选择运行等级</div>
      <div class="proto-cards">${cards}</div>
      <div class="proto-foot">
        <span class="dim">战斗中切换不打断当前战斗，下一节点生效</span>
        <button class="btn btn-mini" id="btn-proto-close">关闭</button>
      </div>
    </div>`
  protoPickerEl.style.display = 'flex'
  protoPickerEl.querySelector('#btn-proto-close').onclick = () => { protoPickerEl.style.display = 'none' }
  protoPickerEl.querySelectorAll('.proto-card').forEach((c) => {
    const def = PROTOCOLS.find((p) => p.id === c.dataset.proto)
    if (!def.available) {
      bindTip(c, '该协议等级即将推出，当前不可用。')
      return
    }
    c.onclick = async () => {
      run.settings.protocol = run.settings.protocol === def.id ? 'none' : def.id
      await saveRun()
      protoPickerEl.style.display = 'none'
      // 刷新当前屏幕（战斗内不打断，结束后自然生效）
      const { show, currentScreen } = await import('../router.js')
      const cur = currentScreen()
      if (cur && cur !== 'combat') show(cur)
    }
  })
}
