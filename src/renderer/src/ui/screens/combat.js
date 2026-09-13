// 战斗界面：骰子池渲染 + 事件驱动呈现 + 重抽决策 + 结算
// 常规模式：完整3D骰池呈现；小窗模式：精简状态视图，后台高速自动战斗
import { show, registerScreen, onScreenCleanup } from '../../router.js'
import { battleStep, chooseReroll } from '../../core/combat.js'
import { startBattle, afterBattleVictory, afterBattleDefeat, advanceLayer, nodeAt } from '../../core/run.js'
import { computeEffAttrs } from '../../core/attributes.js'
import { BOSS_POOLS, TRANSLATORS } from '../../data/translators.js'
import { addTranslator } from '../../data/events.js'
import { ALL_DICE } from '../../data/diceDefs.js'
import { effectCoef } from '../../core/dice.js'
import { rngInt } from '../../core/rng.js'
import { DicePoolView } from '../../render/dice3d.js'
import { agentTakesOver, agentDecideBossLoot, agentDecideReroll } from '../../core/agentRunner.js'
import { protocolName } from '../../state.js'
import { G, saveRun, saveProfile } from '../../state.js'
import { playSfx } from '../../core/sfx.js'
import { setPetFlash, activePet, addPetAffection } from '../../data/pets.js'
import { setPetActivity } from '../../core/petBridge.js'
import { el, fmt, logLine, floatNumber, updateHpBar, statusChips, hpBarHtml, bindTip, sleep, dieName, showTipAt, hideTip, hideTipIfTransient, isTipPinned } from '../components.js'

const KIND_NAMES = {
  ATTACK: '攻击', BARRIER: '屏障', HEAL: '治疗', PSYCHIC: '心理损伤',
  PURE: '纯点数', FRAGILE_SELF: '易碎', EMPOWER: '强化', WEAKEN: '削弱',
  SHIELD: '护盾', PARALYZE: '麻痹', DISPEL: '驱散', COPY: '复刻', ECON: '赏金'
}

// BOSS高阶转译器池：>3个时无放回随机抽3个展示
function drawBossPool(poolIds) {
  if (poolIds.length <= 3) return [...poolIds]
  const arr = [...poolIds]
  const out = []
  for (let i = 0; i < 3; i++) {
    const idx = rngInt(arr.length)
    out.push(arr[idx])
    arr.splice(idx, 1)
  }
  return out
}

// 骰子信息文本（悬停/点击显示；含具体数值与算法）
function dieInfoHtml(die, atk) {
  if (!die) return ''
  const def = ALL_DICE[die.defId]
  const kinds = die.kinds.map((k) => KIND_NAMES[k]).filter(Boolean).join(' · ')
  const lines = [`<b>${def?.name || die.defId} · ${die.pips}点</b>`]
  if (kinds) lines.push(`<span class="dim">${kinds}</span>`)
  const coef = effectCoef(die.pips)
  if (['attack', 'barrier', 'heal'].includes(die.defId)) {
    if (atk != null && atk > 0) {
      const val = Math.floor(atk * coef)
      if (die.defId === 'attack') lines.push(`本颗效果：物理伤害 ≈ ${fmt(val)}<br><span class="dim">= 攻击力 ${fmt(atk)} × 系数 ${(coef * 100).toFixed(1)}%（0.5 + ${die.pips}/12），最终伤害经防御力结算</span>`)
      else if (die.defId === 'barrier') lines.push(`本颗效果：屏障 ${fmt(val)}<br><span class="dim">= 攻击力 ${fmt(atk)} × 系数 ${(coef * 100).toFixed(1)}%（0.5 + ${die.pips}/12）</span>`)
      else lines.push(`本颗效果：治疗 ≈ ${fmt(val)}<br><span class="dim">= 攻击力 ${fmt(atk)} × 系数 ${(coef * 100).toFixed(1)}%（0.5 + ${die.pips}/12），受治疗倍率影响</span>`)
    } else {
      lines.push(def.desc)
    }
  } else if (die.defId === 'overlap' && atk != null && atk > 0) {
    const val = Math.floor(atk * coef)
    lines.push(`本颗效果：屏障 ${fmt(val)} + 治疗 ${fmt(val)}<br><span class="dim">各 = 攻击力 ${fmt(atk)} × 系数 ${(coef * 100).toFixed(1)}%（0.5 + ${die.pips}/12）</span>`)
  } else if (def?.desc) {
    lines.push(def.desc)
  }
  if (die.remaining > 0) lines.push(`<span style="color:var(--amber)">临时骰：${die.remaining}回合后失去</span>`)
  return lines.join('<br>')
}

export function register() {
  registerScreen('combat', renderCombat)
}

function renderCombat(root) {
  const run = G.run
  run.settings = { speed: 1, protocol: 'none', animSkip: false, mini: false, alwaysOnTop: false, ...(run.settings || {}) }
  const mini = !!run.settings.mini
  const { battle, enemySpec } = startBattle(run)
  let speed = run.settings.speed || 1
  let stopped = false
  // 跳过动画：设置开启或小窗模式下生效
  const animSkip = () => !!run.settings.animSkip || mini

  let cont, logEl, phaseEl, overlay, rerollArea, drAlly, drEnemy
  let panelEnemy = null, panelAlly = null, viewEnemy = null, viewAlly = null
  let miniStatusEl // 小窗模式专用元素

  if (mini) {
    // ── 小窗模式：极简界面，仅一行战斗状态 ──
    cont = el(`
    <div class="screen screen-combat mini-combat">
      <div class="mini-combat-core">
        <span class="mini-status" id="mini-status">${nodeAt(run.layer) === 'BOSS' ? '正在与BOSS战斗' : '正在战斗'}</span>
      </div>
      <div class="overlay" id="overlay" style="display:none"></div>
    </div>`)
    root.appendChild(cont)
    overlay = cont.querySelector('#overlay')
    miniStatusEl = cont.querySelector('#mini-status')
  } else {
    // ── 常规模式：完整战斗界面 ──
    cont = el(`
    <div class="screen screen-combat">
      <div class="combat-top panel">
        <div class="combat-title">// ${nodeAt(run.layer) === 'BOSS' ? 'BOSS战' : '普通战斗'} · 第 ${run.layer} 层</div>
        <div class="combat-phase" id="phase">接入中…</div>
        <div class="combat-speed">
          <button class="btn btn-mini" id="btn-anim">动画：${run.settings.animSkip ? '关' : '开'}</button>
          <button class="btn btn-mini" id="btn-speed">速度 ×${speed}</button>
        </div>
      </div>
      <div class="combat-grid">
        <div class="combat-col-main">
          <div class="unit-panel panel enemy" id="panel-enemy">
            <div class="unit-info">
              <div class="unit-name">${battle.enemy.name}</div>
              <div class="unit-desc">${enemySpec.desc || ''}</div>
              ${hpBarHtml('enemy', 'HP')}
              <div class="unit-chips" id="chips-enemy"></div>
            </div>
            <div class="unit-pool"><canvas id="canvas-enemy"></canvas></div>
          </div>
          <div class="combat-center panel">
            <div class="dice-result" id="dice-result">
              <div class="dr-side dr-ally"><span class="dr-label">干员</span><span class="dr-die">—</span></div>
              <div class="dr-vs">VS</div>
              <div class="dr-side dr-enemy"><span class="dr-label">虚质</span><span class="dr-die">—</span></div>
            </div>
            <div class="reroll-area" id="reroll-area"></div>
          </div>
          <div class="unit-panel panel ally" id="panel-ally">
            <div class="unit-pool"><canvas id="canvas-ally"></canvas></div>
            <div class="unit-info">
              <div class="unit-name">${battle.ally.name}</div>
              ${hpBarHtml('ally', 'HP')}
              <div class="unit-chips" id="chips-ally"></div>
            </div>
          </div>
        </div>
        <div class="combat-log panel">
          <div class="log-label">// 战斗记录</div>
          <div class="log-feed" id="log"></div>
        </div>
      </div>
      <div class="overlay" id="overlay" style="display:none"></div>
    </div>`)
    root.appendChild(cont)
    logEl = cont.querySelector('#log')
    phaseEl = cont.querySelector('#phase')
    rerollArea = cont.querySelector('#reroll-area')
    drAlly = cont.querySelector('.dr-ally .dr-die')
    drEnemy = cont.querySelector('.dr-enemy .dr-die')
    overlay = cont.querySelector('#overlay')
    panelEnemy = cont.querySelector('#panel-enemy')
    panelAlly = cont.querySelector('#panel-ally')

    viewEnemy = new DicePoolView(cont.querySelector('#canvas-enemy'))
    viewAlly = new DicePoolView(cont.querySelector('#canvas-ally'))
    viewEnemy.setPool(battle.enemy.pool)
    viewAlly.setPool(battle.ally.pool)

    // 骰子信息交互：悬停跟随显示，点击钉住（含敌方骰池；我方骰附带具体数值）
    const onDieClick = (die, x, y) => { if (die) showTipAt(x, y, dieInfoHtml(die, dieAtk)) }
    const onDieHover = (die, x, y) => {
      if (die) {
        if (!isTipPinned()) showTipAt(x, y, dieInfoHtml(die, dieAtk), false)
      } else {
        hideTipIfTransient()
      }
    }
    viewAlly.onDieClick = onDieClick
    viewEnemy.onDieClick = onDieClick
    viewAlly.onDieHover = onDieHover
    viewEnemy.onDieHover = onDieHover

    // 战斗内快捷开关：跳过动画 / 倍速
    cont.querySelector('#btn-anim').onclick = async (e) => {
      run.settings.animSkip = !run.settings.animSkip
      await saveRun()
      e.target.textContent = `动画：${run.settings.animSkip ? '关' : '开'}`
    }
    cont.querySelector('#btn-speed').onclick = (e) => {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1
      run.settings.speed = speed
      e.target.textContent = `速度 ×${speed}`
    }
  }

  // 骰池变动后刷新渲染（易碎消失/临时骰到期/干涉骰加入等）
  function refreshPools() {
    if (!viewAlly) return
    viewAlly.setPool(battle.ally.pool)
    viewEnemy.setPool(battle.enemy.pool)
  }

  // 我方实际攻击力（含全部修饰，随状态实时变化）
  function dieAtk() {
    return computeEffAttrs(battle.ally).atk
  }

  onScreenCleanup(() => {
    stopped = true
    viewEnemy?.dispose()
    viewAlly?.dispose()
    hideTip()
  })

  // 跳过动画时延时压缩为极短值，小窗模式整体高速
  function delay(ms) {
    if (animSkip()) ms = Math.min(ms, 40)
    if (mini) ms = Math.min(ms, 25)
    return sleep(ms / speed)
  }

  function refreshPanels() {
    if (panelEnemy) updateHpBar(panelEnemy, battle.enemy)
    if (panelAlly) updateHpBar(panelAlly, battle.ally)
    if (!mini) {
      cont.querySelector('#chips-enemy').innerHTML = statusChips(battle.enemy)
      cont.querySelector('#chips-ally').innerHTML = statusChips(battle.ally)
    }
  }

  function addLog(ev) {
    if (mini) return
    const line = logLine(ev)
    if (!line) return
    logEl.appendChild(el(line))
    logEl.scrollTop = logEl.scrollHeight
  }

  refreshPanels()

  // 播放掷骰动画（跳过动画/小窗时直接高亮）
  async function sweep(view, uid) {
    if (!view) return
    if (animSkip()) { view.highlight(uid); await sleep(30); return }
    await view.rollSweep(uid)
  }

  async function present(ev) {
    addLog(ev)
    switch (ev.type) {
      case 'turn':
        if (phaseEl) phaseEl.textContent = `第 ${ev.turn} 回合`
        if (drAlly) { drAlly.textContent = '—'; drEnemy.textContent = '—' }
        viewAlly?.highlight(null)
        viewEnemy?.highlight(null)
        break
      case 'draw':
        playSfx('dice')
        if (ev.side === 'ally') { if (drAlly) drAlly.textContent = `${ev.pips}点 · ${dieName(ev.name)}`; await sweep(viewAlly, ev.uid) }
        else { if (drEnemy) drEnemy.textContent = `${ev.pips}点 · ${dieName(ev.name)}`; await sweep(viewEnemy, ev.uid) }
        break
      case 'reroll':
        playSfx('dice')
        if (ev.side === 'ally') { if (drAlly) drAlly.textContent = `${ev.pips}点 · 重抽`; await sweep(viewAlly, ev.uid ?? -1) }
        break
      case 'damage': {
        playSfx(ev.side === 'ally' ? 'hit' : 'hitEnemy')
        const panel = ev.side === 'ally' ? panelAlly : panelEnemy
        if (!mini) {
          floatNumber(panel, `-${fmt(ev.amount)}`, 'fn-dmg')
          if (ev.blocked > 0) floatNumber(panel, `挡${fmt(ev.blocked)}`, 'fn-block')
        }
        break
      }
      case 'damageZero': {
        playSfx('block')
        if (!mini) floatNumber(ev.side === 'ally' ? panelAlly : panelEnemy, ev.label, 'fn-block')
        break
      }
      case 'heal': {
        if (ev.amount > 0) playSfx('heal')
        if (!mini && ev.amount > 0) floatNumber(ev.side === 'ally' ? panelAlly : panelEnemy, `+${fmt(ev.amount)}`, 'fn-heal')
        break
      }
      case 'shieldLayerGain':
      case 'barrierGain':
        playSfx('block')
        break
      case 'psychic':
        playSfx('psychic')
        break
      case 'crash':
        playSfx('crash')
        break
      case 'paralysis':
      case 'paralyzed':
        playSfx('para')
        break
      case 'buff':
        playSfx('buff')
        break
      case 'debuff':
        playSfx('debuff')
        break
      case 'action':
        refreshPanels()
        refreshPools()
        await delay(260)
        break
      case 'dieAdded':
      case 'tempDieExpire':
        refreshPools()
        break
      case 'victory':
        playSfx('victory')
        setPetFlash('happy', 4000)
        setPetActivity('战斗胜利！')
        // 桌宠好感度：每场胜利 +1
        if (activePet(G.profile)) {
          addPetAffection(G.profile, G.profile.pet.active, 1)
          saveProfile()
        }
        if (miniStatusEl) miniStatusEl.textContent = '战斗胜利'
        refreshPanels()
        break
      case 'defeat':
        playSfx('defeat')
        setPetFlash('dispirited', 5000)
        setPetActivity('战斗失败…')
        if (miniStatusEl) miniStatusEl.textContent = '战斗失败'
        refreshPanels()
        break
      default:
        refreshPanels()
    }
    refreshPanels()
  }

  function handleWaiting() {
    return new Promise((resolve) => {
      const w = battle.waiting
      if (!w || w.type !== 'reroll') { resolve(); return }
      const die = battle._drawn?.ally
      const drawnPips = die?.pips ?? 0
      // 协议接管：自动代理按方案重抽偏好，智慧代理AI决策（失败回落方案）；小窗/桌宠后台同样生效
      if (agentTakesOver()) {
        const ctx = {
          layer: run.layer, turn: battle.turn, drawnPips,
          die: die ? `${die.name ?? die.defId}·${die.pips}点` : '未知',
          hp: Math.floor(battle.ally.hp), enemyHp: Math.floor(battle.enemy.hp)
        }
        agentDecideReroll(w.options, drawnPips, ctx).then(async (idx) => {
          if (stopped) { resolve(); return }
          const evs = chooseReroll(battle, idx)
          for (const ev of evs) await present(ev)
          resolve()
        })
        return
      }
      // 小窗模式：自动保留结果，不打断后台战斗
      if (mini) { chooseReroll(battle, null); resolve(); return }
      // 常规模式：等待玩家重抽决策，桌宠显示疑问表情
      setPetFlash('query', 8000)
      rerollArea.innerHTML = ''
      const keep = el('<button class="btn btn-mini">保留结果</button>')
      keep.onclick = async () => {
        rerollArea.innerHTML = ''
        const evs = chooseReroll(battle, null)
        for (const ev of evs) await present(ev)
        resolve()
      }
      rerollArea.appendChild(keep)
      w.options.forEach((opt, i) => {
        const b = el(`<button class="btn btn-mini btn-warn">重抽 · ${opt.label}</button>`)
        b.onclick = async () => {
          rerollArea.innerHTML = ''
          const evs = chooseReroll(battle, i)
          for (const ev of evs) await present(ev)
          resolve()
        }
        rerollArea.appendChild(b)
      })
    })
  }

  async function drive() {
    await delay(400)
    while (!stopped && !battle.over) {
      const res = battleStep(battle)
      for (const ev of res.events) {
        if (stopped) return
        await present(ev)
      }
      if (battle.over) break
      if (battle.waiting) { await handleWaiting(); continue }
      if (battle.phase === 'turnEnd' || battle.phase === 'turnStart') await delay(420)
      else await delay(160)
    }
    if (!stopped) await onBattleEnd()
  }

  async function onBattleEnd() {
    await delay(600)
    if (battle.over === 'victory') {
      const rewards = afterBattleVictory(run, battle)
      // BOSS战：高阶转译器三选一（池扩充后无放回随机抽3展示；协议运行时仍需手动选择，小窗内同样展示）
      if (nodeAt(run.layer) === 'BOSS' && enemySpec.id && BOSS_POOLS[enemySpec.id]) {
        await bossChoice(drawBossPool(BOSS_POOLS[enemySpec.id]))
      }
      if (mini) {
        // 小窗模式：不展示结算面板，直接流转
        advanceLayer(run)
        await saveRun()
        show('map')
        return
      }
      overlay.style.display = 'flex'
      overlay.innerHTML = `
        <div class="overlay-panel panel">
          <div class="ov-title">目标清除 · VICTORY</div>
          <div class="ov-body">
            <div class="ov-line">通量奖励 <b class="c-flux">+${fmt(rewards.flux)}</b>（现有 ${fmt(run.flux)}）</div>
            <div class="ov-line">自动修复 <b class="c-heal">+${fmt(rewards.healed)}</b> 生命值</div>
          </div>
          <button class="btn btn-primary" id="ov-next">返回行动线</button>
        </div>`
      let proceeded = false
      const proceed = async () => {
        if (proceeded || stopped) return
        proceeded = true
        advanceLayer(run)
        await saveRun()
        show('map')
      }
      overlay.querySelector('#ov-next').onclick = proceed
      // 协议运行中：短暂展示结算后自动返回行动线
      if (run.settings.protocol !== 'none') {
        await delay(2000)
        await proceed()
      }
    } else {
      // 记录末场战斗信息（进化模式局末报告用）
      G.lastBattle = {
        enemy: battle.enemy.name,
        turns: battle.turn ?? null,
        layer: run.layer,
        nodeType: nodeAt(run.layer),
        allyHpLeft: Math.max(0, Math.floor(battle.ally.hp)),
        allyBarrier: Math.floor(battle.ally.barrier || 0)
      }
      afterBattleDefeat(run, battle)
      await saveRun()
      show('gameover')
    }
  }

  function bossChoice(poolIds) {
    return new Promise((resolve) => {
      overlay.style.display = 'flex'
      overlay.innerHTML = `<div class="overlay-panel panel">
        <div class="ov-title">高阶转译器 · 三选一</div>
        <div class="agent-note dim" id="boss-agent-note" style="display:none"></div>
        <div class="ov-cards" id="ov-cards"></div>
      </div>`
      const cards = overlay.querySelector('#ov-cards')
      const noteEl = overlay.querySelector('#boss-agent-note')
      const cardEls = []
      poolIds.forEach((id) => {
        const def = TRANSLATORS[id]
        const card = el(`<div class="ov-card">
          <div class="ov-card-name">${def.name}</div>
          <div class="ov-card-desc">${def.desc}</div>
        </div>`)
        bindTip(card, def.desc)
        card.onclick = () => {
          addTranslator(run, id)
          resolve()
        }
        cards.appendChild(card)
        cardEls.push(card)
      })
      // 协议接管：自动代理按优先级；智慧代理AI决策（失败回落优先级）
      if (agentTakesOver()) {
        noteEl.style.display = 'block'
        noteEl.textContent = `${protocolName(run.settings.protocol)}决策中…`
        setPetFlash('ponder', 8000) // AI智慧决策：桌宠思索
        setPetActivity('正在决策')
        cardEls.forEach((c) => { c.style.pointerEvents = 'none'; c.style.opacity = '0.6' })
        agentDecideBossLoot(enemySpec.id, poolIds, run).then((res) => {
          if (res.choice == null) return
          const pickId = poolIds[res.choice]
          noteEl.textContent = `${protocolName(run.settings.protocol)}选择：${TRANSLATORS[pickId]?.name || pickId}${res.error ? '（AI不可用，已回落本地优先级）' : ''}`
          setTimeout(() => {
            addTranslator(run, pickId)
            resolve()
          }, 800)
        })
      }
    })
  }

  drive()
}
