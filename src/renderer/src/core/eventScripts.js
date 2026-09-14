// 事件与奖励关：结果 fx 注册表 + 具名脚本 + 编译器
// 事件选项两种声明方式：
//   { label, cost?, script: "脚本名", scriptParams: {...} }        → 具名脚本（复杂分支，如随机数/谐振仪式）
//   { label, cost?, outcomes: [ {fx, params} ], text?: "静态文本" } → 声明式结果（fx 可返回动态文本）
import { rngInt, rngPick } from './rng.js'
import { runMaxHp } from './run.js'
import { addTranslator, grantRandomTranslator } from '../data/events.js'
import { TRANSLATORS } from '../data/translators.js'

// ── 结果 fx（ctx = { run }）：可返回 { text } 提供动态结果文本 ──
const OUTCOME_FX = {
  // 获得通量
  flux(p, ctx) { ctx.run.flux += p.amount },
  // 恢复生命比例
  healPct(p, ctx) { ctx.run.healPct(p.pct) },
  // 修改生命上限 / 攻击力（本局）
  modMaxHp(p, ctx) { ctx.run.modMaxHp(p.mult) },
  modAtk(p, ctx) { ctx.run.modAtk(p.bonus) },
  // 以当前生命比例支付代价（保底1点），返回动态文本
  hpCost(p, ctx) {
    const dmg = Math.floor(ctx.run.hp * p.pct)
    ctx.run.hp = Math.max(p.keepMin ?? 1, ctx.run.hp - dmg)
    ctx.run.flux += p.flux ?? 0
    return { text: `失去${dmg}点生命值${p.flux ? `，获得${p.flux}通量` : ''}。`, dmg }
  },
  // 标记下一场战斗
  nextBattleMark(p, ctx) {
    ctx.run.nextBattleMark = {
      ...(ctx.run.nextBattleMark || {}),
      enemyHpMult: p.enemyHpMult, enemyAtkMult: p.enemyAtkMult, fluxMult: p.fluxMult
    }
  },
  // 本局永久额外骰子
  extraDie(p, ctx) { ctx.run.extraDice.push(p.id) },
  // 生命已满时走 then，否则走 else（冗余备份）
  ifFullHp(p, ctx) {
    const full = ctx.run.hp >= runMaxHp(ctx.run)
    const list = full ? p.then : p.else
    let text = null
    for (const e of list || []) {
      const r = OUTCOME_FX[e.fx]?.(e.params || {}, ctx)
      if (r?.text) text = r.text
    }
    return { text }
  },
  // 获得随机普通转译器（优先未持有），返回动态文本
  grantRandomTranslator(p, ctx) {
    const t = grantRandomTranslator(ctx.run)
    if (t) {
      addTranslator(ctx.run, t.id)
      return { text: `${p.prefix || '获得'}转译器【${t.name}】。` }
    }
    return { text: p.fallback || '转译器储备已耗尽。' }
  }
}

// ── 具名脚本（复杂分支逻辑；数值尽可能来自 scriptParams）──
const SCRIPTS = {
  // 随机数事件：掷 1~6，按点数分档结算
  randomNumberRoll(run, params) {
    const roll = rngInt(6) + 1
    if (roll <= 2) return { text: `掷出了 ${roll}。随机数不总是站在你这边。`, roll }
    if (roll <= 4) {
      run.flux += params.midFlux
      return { text: `掷出了 ${roll}。返还${params.midFlux}通量。`, roll }
    }
    if (roll === 5) {
      const pick = rngPick(params.dicePool)
      run.extraDice.push(pick)
      return { text: '掷出了 5。一颗特殊骰子加入了你的骰池。', roll, extra: pick }
    }
    const t = grantRandomTranslator(run)
    if (t) {
      addTranslator(run, t.id)
      return { text: '掷出了 6。获得转译器【' + t.name + '】。', roll }
    }
    run.flux += params.highFlux
    return { text: `掷出了 6。改为获得${params.highFlux}通量。`, roll }
  },

  // 谐振仪式：强化1个可叠加转译器，随机移除1个其他普通转译器作为代价
  resonanceRitual(run) {
    const stackables = run.translators.filter((t) => TRANSLATORS[t.id]?.stackable)
    if (stackables.length === 0) return { text: '没有可强化的转译器，仪式中止。' }
    const target = rngPick(stackables)
    target.stacks++
    let removedText = ''
    const others = run.translators.filter((t) => t !== target && TRANSLATORS[t.id]?.tier === 'normal')
    if (others.length > 0) {
      const removed = rngPick(others)
      run.translators = run.translators.filter((t) => t !== removed)
      if (run.coreSlots.includes(removed.id)) run.coreSlots[run.coreSlots.indexOf(removed.id)] = null
      removedText = ` 作为代价，【${TRANSLATORS[removed.id].name}】被移除。`
    }
    return { text: `【${TRANSLATORS[target.id].name}】层数+1。${removedText}` }
  }
}

// ── 编译器：把 JSON 事件选项编译为带 resolve 的运行时选项 ──
export function compileEvent(def) {
  return {
    ...def,
    options: (def.options || []).map((o) => ({ ...o, resolve: buildResolve(o) }))
  }
}

export function compileRewardOption(def) {
  // 奖励关的 resolve 直接返回结果文本字符串（reward 屏约定）
  if (def.script) {
    return { ...def, resolve: (run) => SCRIPTS[def.script](run, def.scriptParams || {}).text }
  }
  const outcomes = def.outcomes || []
  return {
    ...def,
    resolve: (run) => {
      let text = null
      for (const e of outcomes) {
        const r = OUTCOME_FX[e.fx]?.(e.params || {}, { run })
        if (r?.text) text = r.text
      }
      return text ?? def.text ?? ''
    }
  }
}

function buildResolve(o) {
  if (o.script) {
    return (run) => SCRIPTS[o.script](run, o.scriptParams || {})
  }
  const outcomes = o.outcomes || []
  return (run) => {
    let text = null
    for (const e of outcomes) {
      const r = OUTCOME_FX[e.fx]?.(e.params || {}, { run })
      if (r?.text) text = r.text
    }
    return { text: text ?? o.text ?? '' }
  }
}

// fx 名称集合（供资源 lint 校验）
export const OUTCOME_FX_NAMES = Object.keys(OUTCOME_FX)
export const SCRIPT_NAMES = Object.keys(SCRIPTS)
