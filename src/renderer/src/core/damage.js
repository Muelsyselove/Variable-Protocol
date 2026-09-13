// 伤害公式（见《基本公式》）
export const DamageType = {
  PHYSICAL: 'PHYSICAL',
  MAGIC: 'MAGIC',
  PSYCHIC: 'PSYCHIC',
  TRUE: 'TRUE',
  HEAL: 'HEAL'
}

export const DAMAGE_TYPE_NAME = {
  PHYSICAL: '物理伤害',
  MAGIC: '法术伤害',
  PSYCHIC: '心理伤害',
  TRUE: '真实伤害',
  HEAL: '治疗'
}

// 基本伤害 = 攻击力 × 攻击力倍率 + 附加攻击力
export function basicDamage(atk, atkMult, bonusAtk = 0) {
  return atk * atkMult + bonusAtk
}

// 按伤害类型的结算公式
// def: 目标防御力；resist: 目标法抗/心理抗性；penPct/penFlat: 对应穿透
export function typeFormula(type, A, ctx = {}) {
  const {
    penPct = 0, penFlat = 0,
    def = 0, resist = 0
  } = ctx
  switch (type) {
    case DamageType.PHYSICAL:
      // DMG = max(0.05A, A - (1-Ip)·max(0, D-Iv))
      return Math.max(0.05 * A, A - (1 - penPct) * Math.max(0, def - penFlat))
    case DamageType.MAGIC:
      // DMG = max(0.05A, 0.01A·max(0, 100-(1-Ip)·max(0, D-Iv)))
      return Math.max(0.05 * A, 0.01 * A * Math.max(0, 100 - (1 - penPct) * Math.max(0, resist - penFlat)))
    case DamageType.PSYCHIC:
      // DMG = max(0.05A, 0.01A·max(0, 100-D))
      return Math.max(0.05 * A, 0.01 * A * Math.max(0, 100 - resist))
    case DamageType.TRUE:
    case DamageType.HEAL:
      return A
    default:
      return A
  }
}

// 组装一次伤害请求所需的结算上下文（攻方出力 + 守方属性）
export function buildDamageCtx(type, attackerEff, defenderEff) {
  if (type === DamageType.PHYSICAL) {
    return {
      penPct: attackerEff.physPenPct, penFlat: attackerEff.physPenFlat,
      def: defenderEff.def
    }
  }
  if (type === DamageType.MAGIC) {
    return {
      penPct: attackerEff.magicPenPct, penFlat: attackerEff.magicPenFlat,
      resist: defenderEff.magicResist
    }
  }
  if (type === DamageType.PSYCHIC) {
    return { resist: defenderEff.psychicResist }
  }
  return {}
}
