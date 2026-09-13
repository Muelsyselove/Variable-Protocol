// 武器定义（见《干员与武器》）
// dice: 初始骰池构成；special 为特殊骰 id 列表
export const WEAPONS = [
  {
    id: 'standard',
    name: '标准协议骰组',
    atk: 2200,
    dice: { attack: 4, barrier: 2, heal: 2 },
    special: [],
    desc: '攻击力+2200。初始骰子：攻击×4、屏障×2、治疗×2。稳定可靠。',
    effect: null
  },
  {
    id: 'heavy',
    name: '重核骰组',
    atk: 2800,
    dice: { attack: 6, barrier: 2 },
    special: [],
    desc: '攻击力+2800。初始骰子：攻击×6、屏障×2。物理伤害+15%，无法获得治疗骰子。',
    effect: {
      setup(unit) {
        unit.flags.noHealDice = true
        unit.dealMults.push({
          value: 1.15, label: '重核',
          cond: (dmg) => dmg.type === 'PHYSICAL'
        })
      }
    }
  },
  {
    id: 'interferometer',
    name: '干涉仪骰组',
    atk: 2000,
    dice: { attack: 3, barrier: 3, heal: 1 },
    special: ['interference'],
    desc: '攻击力+2000。初始骰子：攻击×3、屏障×3、治疗×1、干涉骰×1。',
    effect: null
  },
  {
    id: 'ripple',
    name: '涟漪骰组',
    atk: 1900,
    dice: { attack: 3, barrier: 2, heal: 3 },
    special: [],
    desc: '攻击力+1900。初始骰子：攻击×3、屏障×2、治疗×3。治疗骰子的溢出治疗量转化为屏障。',
    effect: {
      setup(unit) {
        unit.flags.healOverflowBarrier = true
      }
    }
  }
]
