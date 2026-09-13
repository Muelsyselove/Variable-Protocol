// 心理损伤与心理崩溃（见《心理伤害》）
import { computeEffAttrs } from './attributes.js'
import { ModifierType } from './attributes.js'
import { typeFormula, DamageType } from './damage.js'
import { runDamagePipeline } from './judgment.js'

export const CRASH_DEFS = {
  gloom: { name: '沉沦崩溃', instant: 12000, duration: 3 },
  chaos: { name: '混沌崩溃', instant: 5000, duration: 2 },
  ruin: { name: '破灭崩溃', instant: 6000, duration: 4 },
  overload: { name: '过载崩溃', instant: 7000, duration: 2 }
}

export const PSYCHIC_TYPE_NAME = {
  gloom: '沉沦损伤', chaos: '混沌损伤', ruin: '破灭损伤', overload: '过载损伤'
}

// 施加心理损伤：仅对敌方（虚质）生效；崩溃期间封锁累计
export function applyPsychicDamage(battle, attacker, target, amount, ptype) {
  const events = []
  if (target.crash) {
    events.push({ type: 'psychicBlocked', side: target.side, label: '崩溃封锁' })
    return events
  }
  // 攻方心理损伤加成（溢出/心理透镜）
  const bonus = attacker?.psychicBonus || 0
  const amplified = amount * (1 + bonus)
  // 受损伤抵抗影响（心理公式，D=损伤抵抗）
  const eff = computeEffAttrs(target)
  const reduced = typeFormula(DamageType.PSYCHIC, amplified, { resist: eff.damageResist })
  target.psychicPool += reduced
  events.push({
    type: 'psychic', side: target.side, ptype,
    amount: Math.floor(reduced), pool: Math.floor(target.psychicPool), max: Math.floor(eff.maxPsy)
  })
  if (target.psychicPool >= eff.maxPsy) {
    events.push(...triggerCrash(battle, attacker, target, ptype))
  }
  return events
}

// 触发心理崩溃：清空累计、瞬间心理伤害、附加惩罚
function triggerCrash(battle, attacker, target, ptype) {
  const def = CRASH_DEFS[ptype]
  target.psychicPool = 0
  target.crash = { type: ptype, turns: def.duration }
  const events = [{ type: 'crash', side: target.side, ptype, name: def.name, turns: def.duration }]

  // 瞬间心理伤害（生命值伤害，走完整伤判管线）
  events.push(...runDamagePipeline(battle, attacker || target.foe, target, {
    type: DamageType.PSYCHIC, amount: def.instant, cause: 'crash'
  }))
  // 干员「溢出」：崩溃时额外造成6000点心理伤害
  if (attacker?.flags?.crashBonus) {
    events.push(...runDamagePipeline(battle, attacker, target, {
      type: DamageType.PSYCHIC, amount: 6000, cause: 'crashBonus'
    }))
  }

  // 崩溃惩罚
  switch (ptype) {
    case 'gloom':
      target.dealMults.push({ value: 0.5, turns: 3, label: '沉沦崩溃' })
      break
    case 'chaos':
      target.actionDmg = { amount: 3000, turns: 2 }
      target.mods.push({ type: ModifierType.ADDITION, attr: 'magicResist', value: -20, turns: 2, label: '混沌崩溃' })
      break
    case 'ruin':
      target.onHitExtra = { amount: 2000, turns: 4 }
      target.mods.push({ type: ModifierType.ADDITION, attr: 'def', value: -200, turns: 4, label: '破灭崩溃' })
      break
    case 'overload':
      // 期间共获得2层麻痹（回合开始逐层入账）
      target.pendingParalysis += 2
      break
  }

  // 转译器钩子（异常捕获等），返回的事件注入事件流
  if (battle?.emit) {
    events.push(...battle.emit('crash', { unit: target, type: ptype, battle }))
  }
  return events
}

// 回合开始推进：崩溃计时、行动伤害计时、受击加伤计时、麻痹入账
export function tickPsychology(unit, events) {
  if (unit.crash) {
    unit.crash.turns--
    if (unit.crash.turns <= 0) {
      events.push({ type: 'crashEnd', side: unit.side, name: CRASH_DEFS[unit.crash.type].name })
      unit.crash = null
    }
  }
  if (unit.actionDmg) {
    unit.actionDmg.turns--
    if (unit.actionDmg.turns <= 0) unit.actionDmg = null
  }
  if (unit.onHitExtra) {
    unit.onHitExtra.turns--
    if (unit.onHitExtra.turns <= 0) unit.onHitExtra = null
  }
  if (unit.pendingParalysis > 0) {
    const gain = Math.min(unit.pendingParalysis, 3 - unit.paralysis)
    if (gain > 0) {
      unit.paralysis += gain
      events.push({ type: 'paralysis', side: unit.side, layers: unit.paralysis, gain })
    }
    unit.pendingParalysis -= gain
    if (unit.pendingParalysis > 0) unit.pendingParalysis--
  }
  // 沉沦崩溃等出力倍率计时；受方易伤计时（裂伤骰等带 turns 的 recvMults）
  unit.dealMults = unit.dealMults.filter((m) => {
    if (m.turns == null) return true
    m.turns--
    return m.turns > 0
  })
  unit.recvMults = unit.recvMults.filter((m) => {
    if (m.turns == null) return true
    m.turns--
    return m.turns > 0
  })
}
