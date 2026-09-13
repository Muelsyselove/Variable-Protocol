// 虚质定义：普通模板 + BOSS（见《虚质图鉴》）
// pool 指定初始骰池构成；基础骰点数在构建战斗时由种子随机数分配
// setup(unit, battle)：构建战斗时注册能力
import { PRIORITY, addShieldLayers, addBarrier } from '../core/judgment.js'
import { rngChance } from '../core/rng.js'

function baseAttrs(o) {
  return {
    atk: o.atk,
    hp: o.hp,
    def: o.def || 0,
    magicResist: o.magicResist || 0,
    maxPsy: 1000,
    psychicResist: o.psychicResist || 0,
    damageResist: o.damageResist || 0
  }
}

export const ENEMY_TEMPLATES = [
  {
    id: 'noise', name: '噪点', minLayer: 1,
    attrs: baseAttrs({ hp: 5000, atk: 1300 }),
    pool: { attack: 5, barrier: 3 },
    desc: '最基础的虚质，没有特殊能力。'
  },
  {
    id: 'echo', name: '残响', minLayer: 1,
    attrs: baseAttrs({ hp: 6500, atk: 1200, def: 600 }),
    pool: { attack: 4, barrier: 4 },
    desc: '余响：每回合开始时获得1层护盾（敌方无法获得护盾，该能力当前无效）。',
    setup(unit, battle) {
      battle.on('turnStart', () => {
        if (unit.hp > 0) return addShieldLayers(unit, 1, '余响')
        return null
      })
    }
  },
  {
    id: 'transient', name: '瞬态', minLayer: 1,
    attrs: baseAttrs({ hp: 4500, atk: 1500 }),
    pool: { attack: 6, barrier: 1 },
    desc: '快闪：抽出5点及以上骰子时，本次行动效果+20%。',
    setup(unit) {
      unit.actionMults.push({ label: '快闪', cond: (_b, _u, _d, pips) => (pips >= 5 ? 1.2 : null) })
    }
  },
  {
    id: 'miscode', name: '错码', minLayer: 1,
    attrs: baseAttrs({ hp: 5000, atk: 1300 }),
    pool: { attack: 4, special: ['erosion', 'erosion'] },
    desc: '初始骰池中带有侵蚀骰。'
  },
  {
    id: 'annihilator', name: '湮参', minLayer: 1,
    attrs: baseAttrs({ hp: 6000, atk: 1300, damageResist: 40 }),
    pool: { attack: 5, barrier: 2 },
    desc: '锚定：免疫脆弱类效果；损伤抵抗40。',
    setup(unit) {
      unit.fragileImmune = true
    }
  },
  {
    id: 'loop', name: '滞环', minLayer: 1,
    attrs: baseAttrs({ hp: 5500, atk: 1100 }),
    pool: { attack: 4, heal: 3 },
    desc: '循环：生命值低于30%时，治疗骰子效果+50%。',
    setup(unit) {
      unit.healMults.push({
        value: 1.5, label: '循环',
        cond: (u) => u.hp < u.attrs.hp * 0.3
      })
    }
  },
  {
    id: 'barrierBody', name: '屏障体', minLayer: 1,
    attrs: baseAttrs({ hp: 5000, atk: 1100 }),
    pool: { attack: 4, barrier: 2 },
    desc: '再生膜：每回合开始时获得400点屏障（敌方屏障获得量固定降低99.9%，实际1点）。',
    setup(unit, battle) {
      battle.on('turnStart', () => {
        if (unit.hp > 0) return addBarrier(unit, 400, '再生膜')
        return null
      })
    }
  },
  {
    id: 'shard', name: '碎片体', minLayer: 3,
    attrs: baseAttrs({ hp: 3500, atk: 1200 }),
    pool: { attack: 7 },
    desc: '纯粹的攻击性虚质。'
  },
  {
    id: 'warden', name: '守卫体', minLayer: 4,
    attrs: baseAttrs({ hp: 7000, atk: 1150, def: 300 }),
    pool: { attack: 4, barrier: 2, special: ['shieldDie', 'bastionDie'] },
    desc: '棱堡：初始骰池中带有护盾骰与棱堡骰，防御力较高。'
  },
  {
    id: 'caster', name: '术式体', minLayer: 6,
    attrs: baseAttrs({ hp: 6000, atk: 1400, magicResist: 20 }),
    pool: { attack: 3, barrier: 2, special: ['magicDie', 'cometDie'] },
    desc: '初始骰池中带有法能骰与彗星骰，造成法术伤害。'
  },
  {
    id: 'reaver', name: '掠夺体', minLayer: 9,
    attrs: baseAttrs({ hp: 9000, atk: 1550 }),
    pool: { attack: 4, heal: 1, special: ['chainDie', 'gatlingDie', 'regenDie'] },
    desc: '初始骰池中带有链式骰、弹幕骰与再生骰，多段伤害并持续回复。'
  },
  {
    id: 'abyssEcho', name: '深渊回声', minLayer: 8,
    attrs: baseAttrs({ hp: 8500, atk: 1500, magicResist: 30 }),
    pool: { attack: 5, barrier: 2, special: ['erosion'] },
    desc: '共鸣：抽出与上一回合相同类型的骰子时，本次行动效果+15%。',
    setup(unit) {
      unit.actionMults.push({
        label: '共鸣',
        cond: (_b, u, die) => (u.lastDieKind != null && die.kinds.join(',') === u.lastDieKind ? 1.15 : null)
      })
    }
  }
]

export const BOSSES = [
  {
    id: 'verifier', name: '校验者', minLayer: 5, boss: true,
    attrs: baseAttrs({ hp: 18000, atk: 2400, def: 400 }),
    pool: { attack: 5, barrier: 3, special: ['verify', 'verify'] },
    desc: '容错校验：受到伤害时，25%概率使该伤害减半。',
    setup(unit) {
      unit.judges.push({
        priority: PRIORITY.MODIFY, label: '容错校验',
        apply: () => (rngChance(0.25)
          ? { mult: 0.5, event: { type: 'judgeProc', side: unit.side, label: '容错校验：伤害减半' } }
          : null)
      })
    }
  },
  {
    id: 'recursion', name: '递归体', minLayer: 10, boss: true,
    attrs: baseAttrs({ hp: 30000, atk: 2700 }),
    pool: { attack: 6, barrier: 2 },
    desc: '递归加深：连续抽出攻击骰子时，每连续1次攻击骰伤害+25%（上限+75%）。',
    setup(unit) {
      let consec = 0
      unit.actionMults.push({
        label: '递归加深',
        cond: (_b, _u, die) => {
          if (die.kinds.includes('ATTACK')) consec = Math.min(consec + 1, 4)
          else consec = 0
          return consec >= 2 ? 1 + 0.25 * Math.min(consec - 1, 3) : null
        }
      })
    }
  },
  {
    id: 'nullref', name: '空引用', minLayer: 15, boss: true,
    attrs: baseAttrs({ hp: 42000, atk: 3000, psychicResist: 60 }),
    pool: { attack: 4, barrier: 3, special: ['interference'] },
    desc: '无效化：我方抽出的骰子若为5点及以上，其点数视为4。',
    // 引擎在构建时读取 clampAllyPips 生效
    clampAllyPips: 4
  }
]
