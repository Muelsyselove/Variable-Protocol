// 伤判效果链：伤害/治疗的最终结算管线（见《伤判效果》）
import { computeEffAttrs, tickMods } from './attributes.js'
import { buildDamageCtx, typeFormula, DamageType } from './damage.js'
import { rngChance } from './rng.js'

// 事件优先级：不受伤 → 闪避 → 伤害修改 → 抵挡 → 过量治疗 → 反伤 → 反击
export const PRIORITY = {
  NOHARM: 0,
  DODGE: 1,
  MODIFY: 2,
  BLOCK: 3,
  OVERHEAL: 4,
  REFLECT: 5,
  COUNTER: 6
}

// 敌方（虚质）获得治疗与屏障的全局衰减系数：固定降低99.9%
export const ENEMY_SUPPORT_PENALTY = 0.001

// 添加屏障（数值盾）：无持续时间，累计吸收伤害直至耗尽或战斗结束
// unit.barrierMult：屏障获取倍率（互斥锁等）
export function addBarrier(unit, value, label = '屏障') {
  const penalized = unit.side === 'enemy' ? value * ENEMY_SUPPORT_PENALTY : value
  const v = Math.max(1, Math.floor(penalized * (unit.barrierMult ?? 1)))
  unit.barrier += v
  return { type: 'barrierGain', side: unit.side, value: v, label }
}

// 添加护盾（次数盾）：每层抵挡一次完整伤害
// 敌方（虚质）无法获得护盾：返回 null（调用方判空后不入事件流）
export function addShieldLayers(unit, count = 1, label = '护盾') {
  if (unit.side === 'enemy') return null
  unit.shieldLayers += count
  return { type: 'shieldLayerGain', side: unit.side, layers: unit.shieldLayers, count, label }
}

// 收集并按优先级排序的伤判效果（脆弱 + 单位自带效果）
function collectJudges(defender) {
  const list = []
  // 脆弱属于伤害修改类（不可叠加免疫时跳过）
  if (defender.fragile > 0 && !defender.fragileImmune) {
    list.push({
      priority: PRIORITY.MODIFY, label: '脆弱',
      apply: (dmg, amount) => ({ mult: 1 + defender.fragile })
    })
  }
  list.push(...defender.judges)
  return list.sort((a, b) => a.priority - b.priority)
}

// 伤害结算主入口
// dmg: { type, amount, die?, depth?, cause?, tags? }
export function runDamagePipeline(battle, attacker, defender, dmg) {
  const events = []
  const depth = dmg.depth || 0
  let amount = dmg.amount

  // 攻方出力倍率（沉沦崩溃-50%、断言模块等；cond 可读取守方）
  for (const m of attacker.dealMults) {
    if (!m.cond || m.cond(dmg, defender)) amount *= m.value
  }
  // 受方伤害倍率（"受到的X伤害+%"类；cond 可读取攻方）
  for (const m of defender.recvMults) {
    if (!m.cond || m.cond(dmg, attacker)) amount *= m.value
  }
  // 伤害类型公式（防御/抗性/穿透）
  const atkEff = computeEffAttrs(attacker)
  const defEff = computeEffAttrs(defender)
  const ctx = buildDamageCtx(dmg.type, atkEff, defEff)
  amount = typeFormula(dmg.type, amount, ctx)

  let zeroed = false, dodged = false, noHarm = false
  let blockedAmount = 0
  const base = amount

  const judges = collectJudges(defender)
  for (const j of judges) {
    // 伤害归零后，检测伤害类与计次数类伤判效果不再处理；反馈类（反伤等）仍可处理
    if (zeroed && j.stopOnZero) continue
    let r = null
    try { r = j.apply(dmg, amount, defender, { base, blockedAmount, zeroed }) } catch { r = null }
    if (!r) continue
    if (j.priority === PRIORITY.NOHARM && r.zero) { zeroed = true; noHarm = true }
    else if (j.priority === PRIORITY.DODGE && r.zero) { zeroed = true; dodged = true }
    else if (j.priority === PRIORITY.MODIFY && r.mult != null) {
      amount *= r.mult
      // 倍率归零（金丝雀部署等）：本次伤害完全无效
      if (amount <= 0) { amount = 0; zeroed = true; noHarm = true }
    }
    else if (j.priority === PRIORITY.BLOCK && r.fullBlock) {
      // 护盾（次数盾）：1层抵挡一次完整伤害
      blockedAmount += amount
      amount = 0
      if (r.onAbsorbed) r.onAbsorbed(amount)
      zeroed = true
    }
    else if (j.priority === PRIORITY.BLOCK && r.absorb != null) {
      // 屏障（数值盾）：按数值吸收
      const absorbed = Math.min(amount, r.absorb)
      amount -= absorbed
      blockedAmount += absorbed
      if (r.onAbsorbed) r.onAbsorbed(absorbed)
      if (amount <= 0.5) { amount = 0; zeroed = true }
    }
    else if (j.priority === PRIORITY.REFLECT && r.reflect != null && depth === 0) {
      // 反伤：对攻击来源造成伤害
      events.push(...runDamagePipeline(battle, defender, attacker, {
        type: r.reflect.type || DamageType.PHYSICAL,
        amount: r.reflect.amount, depth: depth + 1, cause: 'reflect'
      }))
    }
    else if (j.priority === PRIORITY.COUNTER && r.counter != null) {
      // 反击：受击后进行额外行动（预留）
      events.push({ type: 'counter', side: defender.side, label: r.counter })
    }
    if (r.event) events.push(r.event)
    // 通用次数结算：任意优先级的伤判效果均可携带 uses（哨岗骰荆棘等）
    if (j.uses != null) { j.uses--; if (j.uses <= 0) removeJudge(defender, j) }
  }

  if (zeroed) {
    events.push({
      type: 'damageZero', side: defender.side, cause: dodged ? 'dodge' : noHarm ? 'noHarm' : 'block',
      label: dodged ? '闪避' : noHarm ? '不受伤' : '格挡'
    })
  } else {
    const final = Math.max(1, Math.floor(amount))
    defender.hp = Math.max(0, defender.hp - final)
    events.dealt = (events.dealt || 0) + final // 供吸血等按实际伤害结算（数组附加属性）
    events.push({
      type: 'damage', side: defender.side, amount: final, base: Math.floor(base),
      blocked: Math.floor(blockedAmount), dtype: dmg.type, cause: dmg.cause
    })
    // 受击事件钩子（短路求值等）
    if (battle?.emit) {
      events.push(...battle.emit('takeDamage', { battle, unit: defender, amount: final, dmg }))
    }
    // 破灭崩溃：受到攻击时额外受到心理伤害（仅对本次管线触发一次）
    if (defender.onHitExtra && depth === 0 && dmg.type !== DamageType.HEAL) {
      events.push(...runDamagePipeline(battle, attacker, defender, {
        type: DamageType.PSYCHIC, amount: defender.onHitExtra.amount, depth: 1, cause: 'ruin'
      }))
    }
  }
  return events
}

function removeJudge(unit, judge) {
  const i = unit.judges.indexOf(judge)
  if (i >= 0) unit.judges.splice(i, 1)
}

// 抵挡类效果：护盾（次数盾，先判定，每层抵挡一次完整伤害）与屏障（数值盾，吸收剩余伤害）
export function installBlockJudges(unit) {
  unit.judges.push({
    priority: PRIORITY.BLOCK, label: '护盾', stopOnZero: true,
    // 零拷贝：带 pierceShield 标签的伤害无视护盾直接结算
    apply: (dmg) => (unit.shieldLayers > 0 && !dmg?.tags?.includes('pierceShield')
      ? {
        fullBlock: true,
        onAbsorbed: () => { unit.shieldLayers-- },
        event: { type: 'shieldBlock', side: unit.side, layers: unit.shieldLayers - 1 }
      }
      : null)
  })
  unit.judges.push({
    priority: PRIORITY.BLOCK, label: '屏障', stopOnZero: true,
    apply: (_dmg, amount) => {
      if (unit.barrier <= 0) return null
      const r = {
        absorb: unit.barrier,
        onAbsorbed: (taken) => { unit.barrier = Math.max(0, unit.barrier - taken) }
      }
      // 互斥锁（核心效果）：每场屏障首次被完全击破时，立即获得2层护盾
      if (unit.flags.mutexOnBreak && !unit._mutexUsed && amount >= unit.barrier) {
        unit._mutexUsed = true
        r.event = addShieldLayers(unit, 2, '互斥锁')
      }
      return r
    }
  })
}

// 治疗结算管线：治疗倍率 → 敌方衰减 → 上限截断 → 过量转化
export function runHealPipeline(battle, target, amount) {
  const events = []
  let amt = amount
  for (const m of target.healMults || []) {
    if (!m.cond || m.cond(target)) amt *= m.value
  }
  // 敌方（虚质）治疗全局衰减
  if (target.side === 'enemy') amt *= ENEMY_SUPPORT_PENALTY
  const eff = computeEffAttrs(target)
  const cap = eff.hp
  const healed = Math.min(amt, Math.max(0, cap - target.hp))
  const overflow = amt - healed
  target.hp += healed
  events.push({ type: 'heal', side: target.side, amount: Math.floor(healed), overflow: Math.floor(overflow) })
  // 过量治疗转化（涟漪武器/协变核心）
  if (overflow > 0 && target.flags.healOverflowBarrier) {
    events.push(addBarrier(target, overflow, '过量转化'))
  }
  return events
}

export { tickMods }
