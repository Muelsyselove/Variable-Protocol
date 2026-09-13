// 属性计算器：四类修饰器叠加（见《数值》）
// 修饰器格式：{ type, attr, value, turns?, id? }
// ADDITION       直接加算：value 为绝对值
// MULTIPLIER     直接乘算：value 为百分比变动（+0.3 / -0.3）
// FINAL_ADDITION 最终加算：value 为绝对值
// FINAL_SCALER   最终乘算：value 为乘数（1.1），逐项相乘

export const ModifierType = {
  ADDITION: 'ADDITION',
  MULTIPLIER: 'MULTIPLIER',
  FINAL_ADDITION: 'FINAL_ADDITION',
  FINAL_SCALER: 'FINAL_SCALER'
}

export function computeAttribute(base, modifiers, min = -Infinity, max = Infinity) {
  let Dp = 0, Dt = 0, Fp = 0, Ft = 1
  for (const m of modifiers) {
    switch (m.type) {
      case ModifierType.ADDITION: Dp += m.value; break
      case ModifierType.MULTIPLIER: Dt += m.value; break
      case ModifierType.FINAL_ADDITION: Fp += m.value; break
      case ModifierType.FINAL_SCALER: Ft *= m.value; break
    }
  }
  let dt = 1 + Dt
  if (dt < 0) dt = 0
  const af = Ft * ((base + Dp) * dt + Fp)
  return Math.max(min, Math.min(max, af))
}

// 属性取值范围（见《数值》游戏数值范围）
export const ATTR_RANGES = {
  atk: { min: 0, max: Infinity },
  hp: { min: 0, max: Infinity },
  def: { min: 0, max: Infinity },
  magicResist: { min: 0, max: 100 },
  physPenPct: { min: 0, max: 1 },
  magicPenPct: { min: 0, max: 1 },
  physPenFlat: { min: 0, max: Infinity },
  magicPenFlat: { min: 0, max: Infinity },
  maxPsy: { min: 0, max: Infinity },
  psychicResist: { min: 0, max: 100 },
  damageResist: { min: 0, max: 100 }
}

// 计算单位全部实际属性：静态修饰器 + 动态提供器（条件性效果）
// excludeDynamic：排除动态提供器（供提供器内部读取基准值，避免递归）
export function computeEffAttrs(unit, excludeDynamic = false) {
  const mods = [...unit.mods]
  if (!excludeDynamic) {
    for (const p of unit.dynamicProviders) {
      const extra = p(unit)
      if (extra) mods.push(...extra)
    }
  }
  const eff = {}
  for (const [key, base] of Object.entries(unit.attrs)) {
    const range = ATTR_RANGES[key]
    eff[key] = computeAttribute(base, mods.filter((m) => m.attr === key), range?.min, range?.max)
  }
  return eff
}

// 回合开始时推进计时修饰器，返回到期的修饰器
export function tickMods(unit) {
  const expired = []
  unit.mods = unit.mods.filter((m) => {
    if (m.turns == null) return true
    m.turns--
    if (m.turns <= 0) { expired.push(m); return false }
    return true
  })
  return expired
}
