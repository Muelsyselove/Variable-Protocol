// 特殊事件与奖励关（见《事件与奖励关》）
// 事件选项 resolve(run) 返回结果文本；消耗与条件在 label/resolve 中表达
import { rngInt, rngPick } from '../core/rng.js'
import { NORMAL_POOL, TRANSLATORS as TRANSLATOR_LOOKUP } from './translators.js'
import { G } from '../state.js'
import { placeCoreWithPriority } from '../core/agentConfig.js'

// 工具：获得随机普通转译器（优先未持有的）
export function grantRandomTranslator(run) {
  const owned = new Set(run.translators.map((t) => t.id))
  const unowned = NORMAL_POOL.filter((t) => !owned.has(t.id))
  const pool = unowned.length > 0 ? unowned : NORMAL_POOL.filter((t) => t.stackable)
  if (pool.length === 0) return null
  return rngPick(pool)
}

export function addTranslator(run, id) {
  const found = run.translators.find((t) => t.id === id)
  const def = TRANSLATOR_LOOKUP[id]
  if (found) {
    if (def.stackable) found.stacks++
    else return false
  } else {
    run.translators.push({ id, stacks: 1 })
    // 核心转译器入槽：协议接管时按放置优先级（含槽满替换）；否则装第一个空槽
    if (def.tier === 'core') {
      const agentActive = G?.run?.settings?.protocol === 'agent' || G?.run?.settings?.protocol === 'smart'
      if (agentActive) {
        if (!run.coreSlots.includes(id)) placeCoreWithPriority(G.profile.agentConfig, run, id)
      } else {
        const slot = run.coreSlots.indexOf(null)
        if (slot >= 0) run.coreSlots[slot] = id
      }
    }
  }
  def.onAcquire?.(run)
  return true
}

export const EVENTS = [
  {
    id: 'randomNumber', name: '随机数',
    desc: '一台老旧的随机数发生器仍在运转。投入通量，它会吐出一个 1~6 的数。',
    options: [
      {
        label: '投入30通量，掷一次随机数', cost: 30,
        resolve(run) {
          const roll = rngInt(6) + 1
          if (roll <= 2) return { text: `掷出了 ${roll}。随机数不总是站在你这边。`, roll }
          if (roll <= 4) {
            run.flux += 60
            return { text: `掷出了 ${roll}。返还60通量。`, roll }
          }
          if (roll === 5) {
            const dice = [
              'gloomDie', 'chaosDie', 'ruinDie', 'overloadDie', 'verify', 'purify',
              'shieldDie', 'bastionDie', 'regenDie', 'sentryDie', 'firstAidDie',
              'magicDie', 'cometDie', 'chainDie', 'gatlingDie', 'pierceDie',
              'leechDie', 'cacheDie', 'vanguardDie', 'bountyDie', 'shieldSurgeDie',
              'desperateDie', 'manaVeilDie', 'twinMindDie', 'transposeDie'
            ]
            const pick = rngPick(dice)
            run.extraDice.push(pick)
            return { text: `掷出了 5。一颗特殊骰子加入了你的骰池。`, roll, extra: pick }
          }
          const t = grantRandomTranslator(run)
          if (t) { addTranslator(run, t.id); return { text: '掷出了 6。获得转译器【' + t.name + '】。', roll } }
          run.flux += 80
          return { text: '掷出了 6。改为获得80通量。', roll }
        }
      },
      { label: '离开', resolve: () => ({ text: '你无视了它的嗡鸣。' }) }
    ]
  },
  {
    id: 'dataDebris', name: '数据残骸',
    desc: '一段漂浮的数据残骸，似乎还有利用价值。',
    options: [
      {
        label: '回收残骸（获得50通量）',
        resolve(run) { run.flux += 50; return { text: '回收完成，获得50通量。' } }
      },
      {
        label: '解析残骸（恢复25%生命值）',
        resolve(run) { run.healPct(0.25); return { text: '解析完成，恢复25%生命值。' } }
      },
      {
        label: '提取模块（随机普通转译器）',
        resolve(run) {
          const t = grantRandomTranslator(run)
          if (t) { addTranslator(run, t.id); return { text: '提取成功，获得转译器【' + t.name + '】。' } }
          return { text: '残骸中没有任何可用模块。' }
        }
      }
    ]
  },
  {
    id: 'overclock', name: '超频实验',
    desc: '一次高风险的超频实验。献祭生命值上限，换取攻击力。',
    options: [
      {
        label: '献祭20%生命值上限，攻击力+15%（本局）',
        resolve(run) {
          run.modMaxHp(0.8)
          run.modAtk(0.15)
          return { text: '实验完成。生命值上限-20%，攻击力+15%。' }
        }
      },
      { label: '拒绝', resolve: () => ({ text: '你退出了实验室。' }) }
    ]
  },
  {
    id: 'resonance', name: '谐振仪式',
    desc: '古老的谐振仪式：强化一枚已有的转译器。',
    options: [
      {
        label: '强化1个可叠加转译器（代价：随机移除1个其他普通转译器）',
        resolve(run) {
          const stackables = run.translators.filter((t) => TRANSLATOR_LOOKUP[t.id]?.stackable)
          if (stackables.length === 0) return { text: '没有可强化的转译器，仪式中止。' }
          const target = rngPick(stackables)
          target.stacks++
          let removedText = ''
          const others = run.translators.filter((t) => t !== target && TRANSLATOR_LOOKUP[t.id]?.tier === 'normal')
          if (others.length > 0) {
            const removed = rngPick(others)
            run.translators = run.translators.filter((t) => t !== removed)
            if (run.coreSlots.includes(removed.id)) run.coreSlots[run.coreSlots.indexOf(removed.id)] = null
            removedText = ` 作为代价，【${TRANSLATOR_LOOKUP[removed.id].name}】被移除。`
          }
          return { text: `【${TRANSLATOR_LOOKUP[target.id].name}】层数+1。${removedText}` }
        }
      },
      { label: '离开', resolve: () => ({ text: '仪式需要一个你不愿付出的代价。' }) }
    ]
  },
  {
    id: 'entropyAbyss', name: '熵蚀深渊',
    desc: '深渊中回荡着低语：用鲜血交换通量。',
    options: [
      {
        label: '受到当前生命15%的真实伤害，换取120通量',
        resolve(run) {
          const dmg = Math.floor(run.hp * 0.15)
          run.hp = Math.max(1, run.hp - dmg)
          run.flux += 120
          return { text: `失去${dmg}点生命值，获得120通量。`, dmg }
        }
      },
      { label: '拒绝', resolve: () => ({ text: '你转身离开了深渊。' }) }
    ]
  },
  {
    id: 'parallelSample', name: '平行样本',
    desc: '一份来自平行行动线的样本，可以标记下一场战斗。',
    options: [
      {
        label: '标记：下一场敌方生命值-30%，通量奖励减半',
        resolve(run) {
          run.nextBattleMark = { enemyHpMult: 0.7, fluxMult: 0.5 }
          return { text: '样本已标记下一场战斗。' }
        }
      },
      { label: '不使用', resolve: () => ({ text: '样本被放回了容器。' }) }
    ]
  },
  {
    id: 'voidWhisper', name: '虚空低语',
    desc: '虚空中传来低语，向你提供一颗被诅咒的强袭骰。',
    options: [
      {
        label: '接受强袭骰（代价：下一场敌方攻击力+10%）',
        resolve(run) {
          run.extraDice.push('assault')
          run.nextBattleMark = { enemyAtkMult: 1.1 }
          return { text: '强袭骰已加入骰池。下一场战斗敌方攻击力+10%。' }
        }
      },
      { label: '拒绝', resolve: () => ({ text: '低语消散了。' }) }
    ]
  },
  {
    id: 'redundantBackup', name: '冗余备份',
    desc: '一份冗余备份静静等待读取。',
    options: [
      {
        label: '读取备份',
        resolve(run) {
          const maxHp = run.maxHpBase * (run.maxHpMult || 1)
          if (run.hp >= maxHp) {
            run.flux += 60
            return { text: '生命值已满，备份转化为60通量。' }
          }
          run.healPct(0.3)
          return { text: '恢复30%生命值。' }
        }
      }
    ]
  }
]

// 奖励关三选一
export const REWARD_OPTIONS = [
  {
    label: '随机普通转译器',
    resolve(run) {
      const t = grantRandomTranslator(run)
      if (t) { addTranslator(run, t.id); return '获得转译器【' + t.name + '】。' }
      return '转译器储备已耗尽。'
    }
  },
  {
    label: '80通量',
    resolve(run) { run.flux += 80; return '获得80通量。' }
  },
  {
    label: '恢复35%生命值',
    resolve(run) { run.healPct(0.35); return '恢复35%生命值。' }
  }
]

export function randomEvent() {
  return rngPick(EVENTS)
}
