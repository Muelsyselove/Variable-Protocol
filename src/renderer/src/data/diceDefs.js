// 骰子定义（见《骰子机制》《特殊骰子图鉴》）
// kinds: ATTACK/BARRIER/HEAL/PURE/PSYCHIC/WEAKEN/EMPOWER/FRAGILE_SELF/
//        SHIELD/PARALYZE/DISPEL/COPY/ECON...
// onRoll 描述符由战斗引擎解释执行；易碎骰统一由 FRAGILE_SELF 标记在行动末尾离池

export const BASE_DICE = {
  attack: {
    id: 'attack', name: '攻击骰', kinds: ['ATTACK'], pips: null,
    onRoll: [{ fx: 'attack' }],
    desc: '对敌方造成物理伤害，伤害随点数缩放。'
  },
  barrier: {
    id: 'barrier', name: '屏障骰', kinds: ['BARRIER'], pips: null,
    onRoll: [{ fx: 'barrier' }],
    desc: '为我方提供屏障（攻击力×效果系数），累计吸收伤害直至耗尽或战斗结束。'
  },
  heal: {
    id: 'heal', name: '治疗骰', kinds: ['HEAL'], pips: null,
    onRoll: [{ fx: 'heal' }],
    desc: '恢复生命（攻击力×效果系数）。'
  }
}

export const SPECIAL_DICE = {
  interference: {
    id: 'interference', name: '干涉骰', pips: 4, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [
      { fx: 'attack' },
      { fx: 'addDie', target: 'foe', def: 'pure1', defSpec: { id: 'pure1', pips: 1, kinds: ['PURE'] } }
    ],
    desc: '造成物理伤害后，向对方骰池加入1颗1点骰子，随后离开骰池。'
  },
  erosion: {
    id: 'erosion', name: '侵蚀骰', pips: 2, kinds: ['WEAKEN', 'FRAGILE_SELF'],
    onRoll: [
      { fx: 'modFoeAtk', mult: -0.08, label: '侵蚀（攻击力-8%）' }
    ],
    desc: '使对方攻击力-8%（本场战斗），随后离开骰池。'
  },
  verify: {
    id: 'verify', name: '校验骰', pips: 5, kinds: ['ATTACK', 'EMPOWER'],
    onRoll: [
      { fx: 'attack' },
      { fx: 'selfAtk', mult: 0.1, label: '校验（攻击力+10%）' }
    ],
    desc: '造成物理伤害后，攻击力+10%（本场战斗）。'
  },
  assault: {
    id: 'assault', name: '强袭骰', pips: 6, kinds: ['ATTACK', 'EMPOWER', 'FRAGILE_SELF'],
    onRoll: [
      { fx: 'attack' },
      { fx: 'selfAtk', mult: 0.25, label: '强袭（攻击力+25%）' }
    ],
    desc: '造成物理伤害，攻击力+25%（本场战斗），随后离开骰池。'
  },
  overlap: {
    id: 'overlap', name: '重叠骰', pips: 5, kinds: ['BARRIER', 'HEAL'],
    onRoll: [{ fx: 'barrier' }, { fx: 'heal' }],
    desc: '同时提供屏障与治疗，数值分别按 攻击力 × (0.5 + 点数/12) 结算。'
  },
  gloomDie: {
    id: 'gloomDie', name: '沉沦骰', pips: 3, kinds: ['PSYCHIC'],
    onRoll: [{ fx: 'psychic', ptype: 'gloom', amount: 300 }],
    desc: '对敌方造成300点沉沦损伤。'
  },
  chaosDie: {
    id: 'chaosDie', name: '混沌骰', pips: 3, kinds: ['PSYCHIC'],
    onRoll: [{ fx: 'psychic', ptype: 'chaos', amount: 300 }],
    desc: '对敌方造成300点混沌损伤。'
  },
  ruinDie: {
    id: 'ruinDie', name: '破灭骰', pips: 3, kinds: ['PSYCHIC'],
    onRoll: [{ fx: 'psychic', ptype: 'ruin', amount: 300 }],
    desc: '对敌方造成300点破灭损伤。'
  },
  overloadDie: {
    id: 'overloadDie', name: '过载骰', pips: 2, kinds: ['PSYCHIC'],
    onRoll: [{ fx: 'psychic', ptype: 'overload', amount: 350 }],
    desc: '对敌方造成350点过载损伤。'
  },
  purify: {
    id: 'purify', name: '净化骰', pips: 1, kinds: ['FRAGILE_SELF'],
    onRoll: [
      { fx: 'cleanse' }
    ],
    desc: '移除持有方所有负向乘算效果，随后离开骰池。'
  },

  // ── A. 防御系 ────────────────────────────────────────
  shieldDie: {
    id: 'shieldDie', name: '护盾骰', pips: 3, kinds: ['SHIELD'],
    onRoll: [{ fx: 'shield', layers: 1 }],
    desc: '获得1层护盾（次数盾，每层抵挡一次完整伤害）。'
  },
  bastionDie: {
    id: 'bastionDie', name: '棱堡骰', pips: 5, kinds: ['BARRIER', 'SHIELD'],
    onRoll: [{ fx: 'barrier', mult: 1.5 }, { fx: 'shield', layers: 1 }],
    desc: '提供1.5倍系数的屏障，并获得1层护盾。'
  },
  repairDie: {
    id: 'repairDie', name: '修复骰', pips: 4, kinds: ['HEAL'],
    onRoll: [{ fx: 'heal' }, { fx: 'cleanse' }],
    desc: '恢复生命（正常系数），并净化自身全部负向乘算效果。'
  },
  regenDie: {
    id: 'regenDie', name: '再生骰', pips: 2, kinds: ['HEAL'],
    onRoll: [{ fx: 'regrowth', pct: 0.4, turns: 3 }],
    desc: '投出后3回合内，每回合开始恢复攻击力×0.4的生命。'
  },
  firstAidDie: {
    id: 'firstAidDie', name: '急救骰', pips: 1, kinds: ['HEAL', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'heal', mult: 1.3 }],
    desc: '以1.3倍系数治疗，随后离开骰池。'
  },
  sentryDie: {
    id: 'sentryDie', name: '哨岗骰', pips: 3, kinds: ['BARRIER'],
    onRoll: [{ fx: 'barrier' }, { fx: 'thorns', amount: 600, uses: 3, label: '哨岗' }],
    desc: '提供屏障（正常系数），并获得3次哨岗：受击时反弹600点物理伤害。'
  },

  // ── B. 攻击系 ────────────────────────────────────────
  magicDie: {
    id: 'magicDie', name: '法能骰', pips: 4, kinds: ['ATTACK'],
    onRoll: [{ fx: 'attack', dtype: 'MAGIC' }],
    desc: '造成法术伤害（正常系数，受魔法抗性与法术穿透影响）。'
  },
  pierceDie: {
    id: 'pierceDie', name: '穿透骰', pips: 4, kinds: ['ATTACK', 'EMPOWER'],
    onRoll: [{ fx: 'attack' }, { fx: 'penetrate', physPct: 0.3, label: '穿透（物理穿透+30%）' }],
    desc: '造成物理伤害，本场战斗物理穿透+30%。'
  },
  sunderDie: {
    id: 'sunderDie', name: '破甲骰', pips: 3, kinds: ['ATTACK', 'EMPOWER'],
    onRoll: [{ fx: 'attack' }, { fx: 'penetrate', physFlat: 600, label: '破甲（固定穿透+600）' }],
    desc: '造成物理伤害，本场战斗物理固定穿透+600。'
  },
  trueStrikeDie: {
    id: 'trueStrikeDie', name: '真伤骰', pips: 2, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', dtype: 'TRUE' }],
    desc: '造成真实伤害（正常系数，无视防御与抗性），随后离开骰池。'
  },
  executeDie: {
    id: 'executeDie', name: '处决骰', pips: 6, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', foeBelow: 0.3, foeMult: 2 }],
    desc: '造成物理伤害；目标生命低于30%时伤害×2，随后离开骰池。'
  },
  chainDie: {
    id: 'chainDie', name: '链式骰', pips: 4, kinds: ['ATTACK'],
    onRoll: [{ fx: 'attack', mult: 0.6, repeat: 2 }],
    desc: '造成2段伤害，各0.6倍系数（分别结算，分别被护盾/屏障抵挡）。'
  },
  leechDie: {
    id: 'leechDie', name: '吸血骰', pips: 4, kinds: ['ATTACK'],
    onRoll: [{ fx: 'attack', lifesteal: 0.35 }],
    desc: '造成物理伤害，并回复实际造成伤害35%的生命。'
  },
  spikeDie: {
    id: 'spikeDie', name: '尖峰骰', pips: 5, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', mult: 1.6 }, { fx: 'selfDamage', pct: 0.3 }],
    desc: '造成1.6倍物理伤害，但自身受到攻击力×0.3的真实伤害，随后离开骰池。'
  },
  unstableDie: {
    id: 'unstableDie', name: '不稳骰', pips: 1, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', flat: 2500, dtype: 'TRUE' }],
    desc: '造成2500点固定真实伤害（不受攻击力与系数影响），随后离开骰池。'
  },

  // ── C. 干扰控制系 ────────────────────────────────────
  freezeDie: {
    id: 'freezeDie', name: '定身骰', pips: 3, kinds: ['PARALYZE', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'paralyze', layers: 1 }],
    desc: '使对方获得1层麻痹（跳过1次掷骰与行动），随后离开骰池。'
  },
  frailDie: {
    id: 'frailDie', name: '脆弱骰', pips: 2, kinds: ['WEAKEN'],
    onRoll: [{ fx: 'fragile', amount: 0.1 }],
    desc: '使对方获得10%脆弱（可叠加，本场战斗持续）。'
  },
  vulnDie: {
    id: 'vulnDie', name: '裂伤骰', pips: 4, kinds: ['WEAKEN', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'vuln', mult: 0.2, turns: 2, label: '裂伤' }],
    desc: '使对方2回合内受到的伤害+20%，随后离开骰池。'
  },
  dispelDie: {
    id: 'dispelDie', name: '驱散骰', pips: 2, kinds: ['DISPEL', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'dispel' }],
    desc: '移除对方全部正向乘算修饰器，随后离开骰池。'
  },
  floodDie: {
    id: 'floodDie', name: '洪泛骰', pips: 4, kinds: ['WEAKEN', 'FRAGILE_SELF'],
    onRoll: [
      { fx: 'addDie', target: 'foe', def: 'pure1', defSpec: { id: 'pure1', pips: 1, kinds: ['PURE'] } },
      { fx: 'addDie', target: 'foe', def: 'pure1', defSpec: { id: 'pure1', pips: 1, kinds: ['PURE'] } }
    ],
    desc: '向对方骰池塞入2颗1点骰子（受骰池上限约束），随后离开骰池。'
  },

  // ── D. 心理系 ────────────────────────────────────────
  mindBurstDie: {
    id: 'mindBurstDie', name: '心爆骰', pips: 6, kinds: ['PSYCHIC', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'psychic', ptype: 'chaos', amount: 500 }],
    desc: '对敌方造成500点混沌损伤，随后离开骰池。'
  },
  twinMindDie: {
    id: 'twinMindDie', name: '双相骰', pips: 5, kinds: ['PSYCHIC'],
    onRoll: [
      { fx: 'psychic', ptype: 'gloom', amount: 250 },
      { fx: 'psychic', ptype: 'overload', amount: 250 }
    ],
    desc: '依次造成250点沉沦损伤与250点过载损伤（触发崩溃时为过载崩溃）。'
  },
  dreadDie: {
    id: 'dreadDie', name: '惊惧骰', pips: 3, kinds: ['PSYCHIC', 'WEAKEN'],
    onRoll: [{ fx: 'psychic', ptype: 'ruin', amount: 200 }, { fx: 'fragile', amount: 0.1 }],
    desc: '造成200点破灭损伤，并使对方获得10%脆弱。'
  },

  // ── E. 特殊系 ────────────────────────────────────────
  cacheDie: {
    id: 'cacheDie', name: '缓存骰', pips: 4, kinds: ['PURE'],
    onRoll: [{ fx: 'rerollCharge', count: 1 }],
    desc: '获得1次重抽充能（抽出≤3点骰子时可重抽）。'
  },
  duplicateDie: {
    id: 'duplicateDie', name: '复刻骰', pips: 3, kinds: ['COPY', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'copyDie' }],
    desc: '随机复制骰池内1颗其他骰子（含点数与临时性）加入骰池，随后离开骰池；骰池已满则仅离池。'
  },
  vanguardDie: {
    id: 'vanguardDie', name: '先导骰', pips: 6, kinds: ['PURE'],
    onRoll: [],
    desc: '无行动效果，仅以6点参与先后手判定。'
  },
  bountyDie: {
    id: 'bountyDie', name: '赏金骰', pips: 2, kinds: ['ATTACK', 'ECON'],
    onRoll: [{ fx: 'attack' }, { fx: 'bonusFlux', amount: 25 }],
    desc: '造成物理伤害；本场战斗胜利后额外获得25通量（可叠加）。'
  },

  // ── F. 流派扩展系 ────────────────────────────────────
  shieldSurgeDie: {
    id: 'shieldSurgeDie', name: '盾涌骰', pips: 3, kinds: ['SHIELD', 'ATTACK'],
    onRoll: [{ fx: 'shield', layers: 1 }, { fx: 'attack', mult: 0.6 }],
    desc: '获得1层护盾，并造成0.6倍系数的物理伤害。'
  },
  hemoBarrierDie: {
    id: 'hemoBarrierDie', name: '凝血盾骰', pips: 2, kinds: ['BARRIER'],
    onRoll: [{ fx: 'barrier', hemoScale: { base: 0.8, perStep: 0.12, cap: 2 } }],
    desc: '提供屏障：满血时0.8倍系数，每损失10%生命+0.12（上限2倍）。'
  },
  parryDie: {
    id: 'parryDie', name: '格挡骰', pips: 2, kinds: ['SHIELD', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'shield', layers: 2, label: '格挡' }],
    desc: '一次性获得2层护盾，随后离开骰池。'
  },
  mindDrainDie: {
    id: 'mindDrainDie', name: '心蚀骰', pips: 3, kinds: ['PSYCHIC', 'SHIELD'],
    onRoll: [{ fx: 'psychic', ptype: 'ruin', amount: 250 }, { fx: 'shield', layers: 1 }],
    desc: '造成250点破灭损伤，并获得1层护盾。'
  },
  hallucinationDie: {
    id: 'hallucinationDie', name: '幻痛骰', pips: 4, kinds: ['PSYCHIC', 'WEAKEN', 'FRAGILE_SELF'],
    onRoll: [
      { fx: 'psychic', ptype: 'chaos', amount: 300 },
      { fx: 'vuln', mult: 0.15, turns: 2, label: '幻痛' }
    ],
    desc: '造成300点混沌损伤，并使对方2回合内受到的伤害+15%，随后离开骰池。'
  },
  psycheVeilDie: {
    id: 'psycheVeilDie', name: '心幕骰', pips: 2, kinds: ['PSYCHIC', 'HEAL'],
    onRoll: [{ fx: 'psychic', ptype: 'overload', amount: 200 }, { fx: 'heal', mult: 0.5 }],
    desc: '造成200点过载损伤，并以0.5倍系数治疗自身。'
  },
  vengeanceDie: {
    id: 'vengeanceDie', name: '复仇骰', pips: 1, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', hpScale: 0.12 }],
    desc: '造成物理伤害：每损失10%生命，本次伤害+12%（满血约1倍，残血最高约2.1倍），随后离开骰池。'
  },
  desperateDie: {
    id: 'desperateDie', name: '亡命骰', pips: 3, kinds: ['ATTACK', 'BARRIER'],
    onRoll: [
      { fx: 'attack', mult: 1.2, hpBelow: 0.5, boostMult: 1.5 },
      { fx: 'barrier', mult: 0.5, hpBelow: 0.5, boostMult: 1.0 }
    ],
    desc: '造成1.2倍物理伤害并提供0.5倍屏障；生命低于50%时提升为1.5倍与1.0倍。'
  },
  scrapDie: {
    id: 'scrapDie', name: '废料骰', pips: 1, kinds: ['PURE', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'bonusFlux', amount: 15 }],
    desc: '无行动效果；本场战斗胜利后额外获得15通量，随后离开骰池。'
  },
  transposeDie: {
    id: 'transposeDie', name: '转置骰', pips: 4, kinds: ['PURE'],
    onRoll: [{ fx: 'transpose' }],
    desc: '与骰池内随机另一颗骰子交换点数（自身点数变为对方点数）。'
  },
  jackpotDie: {
    id: 'jackpotDie', name: '头奖骰', pips: 6, kinds: ['ATTACK', 'FRAGILE_SELF'],
    onRoll: [{ fx: 'attack', mult: 0.5, firstMover: 3 }],
    desc: '造成0.5倍物理伤害；本回合若抢先手则伤害×3（合计1.5倍），随后离开骰池。'
  },
  cometDie: {
    id: 'cometDie', name: '彗星骰', pips: 5, kinds: ['ATTACK'],
    onRoll: [{ fx: 'attack', dtype: 'MAGIC', mult: 1.4 }],
    desc: '造成1.4倍系数的法术伤害。'
  },
  manaVeilDie: {
    id: 'manaVeilDie', name: '魔幕骰', pips: 4, kinds: ['BARRIER', 'EMPOWER'],
    onRoll: [{ fx: 'barrier' }, { fx: 'penetrate', magicPct: 0.1, label: '魔幕（法术穿透+10%）' }],
    desc: '提供屏障（正常系数），本场战斗法术穿透+10%。'
  },
  gatlingDie: {
    id: 'gatlingDie', name: '弹幕骰', pips: 2, kinds: ['ATTACK'],
    onRoll: [{ fx: 'attack', mult: 0.35, repeat: 3 }],
    desc: '造成3段伤害，各0.35倍系数（分别结算；克制次数盾，亦被次数盾克制）。'
  }
}

// 纯点数骰子（仅参与先后手判定）
export const PURE_DICE = {
  pure1: { id: 'pure1', name: '1点骰', pips: 1, kinds: ['PURE'], onRoll: [], desc: '无行动效果，仅参与先后手判定。' }
}

// 其他来源骰子（商店礼包等）
export const EXTRA_DICE = {
  attack4: { id: 'attack4', name: '攻击骰', pips: 4, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }], desc: '4点攻击骰。' }
}

export const ALL_DICE = { ...BASE_DICE, ...SPECIAL_DICE, ...PURE_DICE, ...EXTRA_DICE }

// 生成带随机点数的基础骰实例定义（1~6点等概率，由调用方传入点数）
export function baseDieWithPips(kind, pips) {
  const def = BASE_DICE[kind]
  return { ...def, pips }
}
