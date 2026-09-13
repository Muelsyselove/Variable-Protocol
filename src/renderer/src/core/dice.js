// 骰子池：独立骰子实例、等概率抽取（见《骰子机制》）
let uidCounter = 1

export function createDie(def) {
  return {
    uid: uidCounter++,
    defId: def.id,
    pips: def.pips,
    kinds: def.kinds || [],
    tags: def.tags || [],
    remaining: def.tempTurns ?? 0, // 临时骰剩余回合，0 表示非临时
    onRoll: def.onRoll || []
  }
}

// 基础骰点数缩放：平缓曲线 效果系数 = 0.5 + 点数/12
export function effectCoef(pips) {
  return 0.5 + pips / 12
}

// 加入骰池（尊重骰池上限与"无法获得治疗骰"限制）
export function addDie(unit, die) {
  if (unit.flags.noHealDice && die.kinds.includes('HEAL')) return false
  if (unit.pool.length >= unit.poolCap) return false
  unit.pool.push(die)
  return true
}

export function removeDie(unit, die) {
  const i = unit.pool.indexOf(die)
  if (i >= 0) unit.pool.splice(i, 1)
}

// 骰子是否为某类型
export function isKind(die, kind) {
  return die.kinds.includes(kind)
}
