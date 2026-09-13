// 干员定义（见《干员与武器》）
import { ModifierType } from '../core/attributes.js'
import { computeEffAttrs } from '../core/attributes.js'

export const OPERATORS = [
  {
    id: 'baseline',
    name: '基准',
    title: '稳态执行者',
    hp: 38000,
    atk: 2600,
    desc: '特殊能力【稳态偏置】：生命值低于50%时，攻击力+25%。',
    setup(unit) {
      unit.dynamicProviders.push((u) => {
        const maxHp = computeEffAttrs(u, true).hp
        return u.hp < maxHp * 0.5
          ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.25, label: '稳态偏置' }]
          : []
      })
    }
  },
  {
    id: 'offset',
    name: '偏移',
    title: '相位观测者',
    hp: 32000,
    atk: 2800,
    desc: '特殊能力【相位重掷】：每场战斗1次，重新抽取自己的骰子。',
    ability(unit) {
      unit.flags.manualReroll = true
    }
  },
  {
    id: 'overflow',
    name: '溢出',
    title: '过载写入者',
    hp: 30000,
    atk: 3000,
    desc: '特殊能力【过压写入】：对敌方心理损伤+30%；敌方心理崩溃时，额外造成6000点心理伤害。',
    ability(unit) {
      unit.psychicBonus += 0.3
      unit.flags.crashBonus = true
    }
  },
  {
    id: 'parity',
    name: '奇偶',
    title: '低值修正者',
    hp: 34000,
    atk: 2600,
    desc: '特殊能力【低值重抽】：抽出1点骰子时重抽一次（每回合限1次）。',
    setup(unit) {
      unit.flags.autoRerollOnes = true
    }
  }
]
