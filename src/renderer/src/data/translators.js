// 转译器定义（见《转译器图鉴》）
// onAcquire(run)：获得时生效（局级）
// onBattle(ctx)：战斗开始时注册钩子，ctx = { battle, ally, stacks, slotted, run }
// onVictory(ctx)：战斗胜利结算钩子，返回 { flux, healPct, permAtk } 追加量
// synergy：连携声明 { requires: id[], desc, onBattle? }——requires 全部持有时激活
//          （修正型联动数值由对应转译器在自身 onBattle/onVictory 内读取持有状态实现）
import { ModifierType } from '../core/attributes.js'
import { addBarrier, addShieldLayers, PRIORITY, runDamagePipeline, runHealPipeline } from '../core/judgment.js'
import { computeEffAttrs } from '../core/attributes.js'
import { createDie, addDie, removeDie } from '../core/dice.js'
import { rngPick, rngChance } from '../core/rng.js'
import { DamageType } from '../core/damage.js'
import { SPECIAL_DICE } from './diceDefs.js'

const T = []

// 持有判定（连携与修正型联动共用）
const hasT = (run, id) => run.translators.some((t) => t.id === id)

// ── 普通转译器 ──────────────────────────────────────────

T.push({
  id: 'fluxSiphon', name: '通量虹吸', tier: 'normal', stackable: true, price: 60,
  desc: '普通战斗结束后，额外获得10%通量。（可叠加）'
})

T.push({
  id: 'hotSpare', name: '热备援', tier: 'normal', stackable: false, price: 90,
  desc: '战斗开始时，获得相当于攻击力100%的屏障。◇连携【蓄能壁垒】：屏障量+50%。',
  onBattle({ battle, ally, run }) {
    battle.on('battleStart', () => {
      const eff = computeEffAttrs(ally)
      const mult = hasT(run, 'barrierCharge') ? 1.5 : 1
      return addBarrier(ally, eff.atk * mult, '热备援')
    })
  }
})

T.push({
  id: 'freqShift', name: '频率偏移', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗开始时获得等同叠加层数的重抽充能：抽出≤3点骰子时可重抽一次。（可叠加）◇连携【重抽大师】：开战额外+1充能。',
  onBattle({ battle, ally, stacks, run }) {
    battle.on('battleStart', () => {
      const bonus = stacks + (hasT(run, 'rerollMastery') ? 1 : 0)
      ally.rerollCharges += bonus
      return { type: 'info', text: `频率偏移：重抽充能 +${bonus}` }
    })
  }
})

T.push({
  id: 'fastIter', name: '快速迭代', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗结束后，攻击力+3%（本局内永久）。（可叠加）',
  onVictory({ stacks }) {
    return { permAtk: 0.03 * stacks }
  }
})

T.push({
  id: 'etchMold', name: '刻蚀模具', tier: 'normal', stackable: true, price: 120,
  desc: '物理伤害倍率+10%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.dealMults.push({
      value: 1 + 0.1 * stacks, label: '刻蚀模具',
      cond: (dmg) => dmg.type === DamageType.PHYSICAL
    })
  }
})

T.push({
  id: 'signalAmp', name: '信号放大', tier: 'normal', stackable: true, price: 60,
  desc: '治疗骰子效果+15%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.healMults.push({ value: 1 + 0.15 * stacks, label: '信号放大' })
  }
})

T.push({
  id: 'psyLens', name: '心理透镜', tier: 'normal', stackable: true, price: 120,
  desc: '对敌方造成的心理损伤+15%。（可叠加）◇连携【突触灼蚀】：每层加成15%→22%。',
  onBattle({ ally, stacks, run }) {
    ally.psychicBonus += (hasT(run, 'synapseBurn') ? 0.22 : 0.15) * stacks
  }
})

T.push({
  id: 'spectrumProbe', name: '频谱探针', tier: 'normal', stackable: true, price: 120,
  desc: '获得时，向我方骰池永久加入1颗沉沦骰（本局内持续）。（可叠加）',
  onAcquire(run) {
    run.extraDice.push('gloomDie')
  }
})

T.push({
  id: 'mirrorReflect', name: '镜相反射', tier: 'normal', stackable: false, price: 120,
  desc: '成功抵挡伤害时，对敌方造成相当于抵挡值30%的物理伤害。',
  onBattle({ ally }) {
    ally.judges.push({
      priority: PRIORITY.REFLECT, label: '镜相反射', stopOnZero: false,
      apply: (_dmg, _amount, _defender, state) => (
        state.blockedAmount > 0
          ? {
            reflect: { amount: state.blockedAmount * 0.3 },
            event: { type: 'judgeProc', side: 'enemy', label: '镜相反射' }
          }
          : null
      )
    })
  }
})

T.push({
  id: 'greedySample', name: '贪婪采样', tier: 'normal', stackable: false, price: 90,
  desc: '商店中的价格-20%。'
})

T.push({
  id: 'fuseBreaker', name: '应急熔断', tier: 'normal', stackable: false, price: 150,
  desc: '一局中首次生命值归零时，以30%生命值复活。◇连携【背水一战】：复活生命30%→60%，并附带2层护盾。',
  onBattle({ battle, ally, run }) {
    if (!run.reviveUsed) {
      ally.flags.reviveAvailable = true
      if (hasT(run, 'lastStand')) {
        ally.flags.reviveHpPct = 0.6
        ally.flags.reviveShields = 2
      }
      battle.on('battleEnd', () => {
        if (!ally.flags.reviveAvailable) run.reviveUsed = true
        return null
      })
    }
  }
})

// ── 普通转译器 · 基础组：经济 ────────────────────────────

T.push({
  id: 'compilerCache', name: '编译缓存', tier: 'normal', stackable: true, price: 60,
  desc: '每场战斗胜利后，额外获得15通量。（可叠加）',
  onVictory({ stacks }) { return { flux: 15 * stacks } }
})

T.push({
  id: 'compoundInterest', name: '复利计息', tier: 'normal', stackable: false, price: 120,
  desc: '每场战斗胜利后，额外获得当前持有通量的5%（单次上限50）。◇连携【通量透镜】：单次上限50→100。',
  onVictory({ run }) {
    const cap = hasT(run, 'fluxLens') ? 100 : 50
    return { flux: Math.min(Math.floor(run.flux * 0.05), cap) }
  }
})

T.push({
  id: 'synergyFund', name: '协同基金', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗胜利后，额外获得5×已持有转译器数量的通量。（可叠加）',
  onVictory({ run, stacks }) { return { flux: 5 * run.translators.length * stacks } }
})

// ── 普通转译器 · 基础组：骰池与抽骰操控 ──────────────────

T.push({
  id: 'quantumReroll', name: '量子重掷', tier: 'normal', stackable: false, price: 150,
  desc: '每场战斗获得1次不限点数的手动重抽（独立于≤3点充能重抽）。◇连携【重抽大师】：每场次1→2次。',
  onBattle({ battle, ally, run }) {
    battle.on('battleStart', () => {
      const n = hasT(run, 'rerollMastery') ? 2 : 1
      ally.flags.rerollAnyCharges += n
      return { type: 'info', text: `量子重掷：不限点数重抽 +${n} 次` }
    })
  }
})

T.push({
  id: 'virtualMemory', name: '虚拟内存', tier: 'normal', stackable: false, price: 150,
  desc: '获得时，本局骰池上限+2。◇连携【骰池架构】：骰池上限再+2。',
  onAcquire(run) { run.poolCapBonus = (run.poolCapBonus || 0) + 2 }
})

T.push({
  id: 'warmCache', name: '热缓存', tier: 'normal', stackable: false, price: 90,
  desc: '每场战斗开始时，向骰池加入1颗3点护盾骰（仅本场）。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      const die = createDie({ ...SPECIAL_DICE.shieldDie })
      const ok = addDie(ally, die)
      return { type: ok ? 'dieAdded' : 'dieAddFail', side: 'ally', pips: die.pips, name: die.defId }
    })
  }
})

T.push({
  id: 'prefetcher', name: '预取器', tier: 'normal', stackable: true, price: 120,
  desc: '每场战斗开始时，加入1颗持续2回合的4点攻击临时骰。（可叠加）',
  onBattle({ battle, ally, stacks }) {
    battle.on('battleStart', () => {
      const evs = []
      for (let i = 0; i < stacks; i++) {
        const die = createDie({ id: 'attack', pips: 4, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }], tempTurns: 2 })
        const ok = addDie(ally, die)
        evs.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: 'ally', pips: 4, name: 'attack' })
      }
      return evs
    })
  }
})

T.push({
  id: 'gcDaemon', name: '垃圾回收', tier: 'normal', stackable: false, price: 90,
  desc: '每场战斗开始时，摧毁敌方骰池中点数最低的2颗骰子。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      const foe = ally.foe
      const sorted = [...foe.pool].sort((a, b) => a.pips - b.pips)
      let n = 0
      for (const d of sorted.slice(0, 2)) { removeDie(foe, d); n++ }
      return { type: 'info', text: `垃圾回收：摧毁敌方${n}颗最低点骰子` }
    })
  }
})

T.push({
  id: 'mirrorPool', name: '镜像池', tier: 'normal', stackable: false, price: 150,
  desc: '每场战斗开始时，复制我方点数最高的1颗骰子（副本仅本场）。◇连携【骰子策展】：复制变为2颗（池满仍只1颗）。',
  onBattle({ battle, ally, run }) {
    battle.on('battleStart', () => {
      const count = hasT(run, 'diceCurator') ? 2 : 1
      const evs = []
      for (let i = 0; i < count; i++) {
        if (ally.pool.length === 0) break
        const src = [...ally.pool].sort((a, b) => b.pips - a.pips)[0]
        const copy = createDie({
          id: src.defId, pips: src.pips, kinds: src.kinds, onRoll: src.onRoll,
          tempTurns: src.remaining > 0 ? src.remaining : 0
        })
        const ok = addDie(ally, copy)
        evs.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: 'ally', pips: copy.pips, name: copy.defId })
      }
      return evs
    })
  }
})

T.push({
  id: 'dieHardening', name: '骰子淬火', tier: 'normal', stackable: false, price: 150,
  desc: '我方易碎骰子投出后不再离开骰池。◇连携【易碎熔炉】：被保留的易碎骰效果+25%→+45%。',
  onBattle({ ally }) {
    ally.flags.fragileKeep = true
  }
})

T.push({
  id: 'backupDie', name: '备用骰', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗开始时，加入1颗2点治疗骰（仅本场）。（可叠加）',
  onBattle({ battle, ally, stacks }) {
    battle.on('battleStart', () => {
      const evs = []
      for (let i = 0; i < stacks; i++) {
        const die = createDie({ id: 'heal', pips: 2, kinds: ['HEAL'], onRoll: [{ fx: 'heal' }] })
        const ok = addDie(ally, die)
        evs.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: 'ally', pips: 2, name: 'heal' })
      }
      return evs
    })
  }
})

T.push({
  id: 'loadedDice', name: '灌铅骰子', tier: 'normal', stackable: false, price: 120,
  desc: '每场战斗中首次抽出≤2点骰子时，本次有效点数视为4。',
  onBattle({ ally }) {
    ally.flags.loadedFirst = true
  }
})

// ── 普通转译器 · 基础组：攻击增益 ────────────────────────

T.push({
  id: 'spellCompiler', name: '法术编译', tier: 'normal', stackable: true, price: 120,
  desc: '法术伤害+15%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.dealMults.push({
      value: 1 + 0.15 * stacks, label: '法术编译',
      cond: (dmg) => dmg.type === DamageType.MAGIC
    })
  }
})

T.push({
  id: 'critPatch', name: '暴击补丁', tier: 'normal', stackable: false, price: 150,
  desc: '6点骰子的本次行动效果×1.8。',
  onBattle({ ally }) {
    ally.actionMults.push({ label: '暴击补丁', cond: (_b, _u, _d, pips) => (pips === 6 ? 1.8 : null) })
  }
})

T.push({
  id: 'lowPipStrike', name: '低位突袭', tier: 'normal', stackable: true, price: 90,
  desc: '≤3点骰子的攻击伤害+25%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.dealMults.push({
      value: 1 + 0.25 * stacks, label: '低位突袭',
      cond: (dmg) => dmg.die?.kinds?.includes('ATTACK') && dmg.die.pips <= 3
    })
  }
})

T.push({
  id: 'executeThreshold', name: '处刑阈值', tier: 'normal', stackable: false, price: 120,
  desc: '目标生命低于25%时，我方造成的伤害+20%。',
  onBattle({ ally }) {
    ally.dealMults.push({
      value: 1.2, label: '处刑阈值',
      cond: (_dmg, defender) => defender.hp > 0 && defender.hp < computeEffAttrs(defender).hp * 0.25
    })
  }
})

T.push({
  id: 'apModule', name: '穿甲模组', tier: 'normal', stackable: true, price: 150,
  desc: '物理穿透+15%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.mods.push({ type: ModifierType.ADDITION, attr: 'physPenPct', value: 0.15 * stacks, label: '穿甲模组' })
  }
})

T.push({
  id: 'mpModule', name: '法穿模组', tier: 'normal', stackable: true, price: 150,
  desc: '法术穿透+15%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.mods.push({ type: ModifierType.ADDITION, attr: 'magicPenPct', value: 0.15 * stacks, label: '法穿模组' })
  }
})

T.push({
  id: 'comboEngine', name: '连击引擎', tier: 'normal', stackable: false, price: 120,
  desc: '连续抽出同类型骰子时，第2颗起效果+30%。◇连携【连击信标】：增伤30%→45%。',
  onBattle({ ally, run }) {
    const mult = hasT(run, 'consecBeacon') ? 1.45 : 1.3
    ally.actionMults.push({ label: '连击引擎', cond: (_b, u) => (u.consecKindCount >= 2 ? mult : null) })
  }
})

T.push({
  id: 'crashExploit', name: '崩溃利用', tier: 'normal', stackable: false, price: 90,
  desc: '对崩溃中的敌人伤害+30%。◇连携【噩梦回响】：增伤30%→50%。',
  onBattle({ ally, run }) {
    const mult = hasT(run, 'nightmareEcho') ? 1.5 : 1.3
    ally.dealMults.push({ value: mult, label: '崩溃利用', cond: (_dmg, defender) => !!defender.crash })
  }
})

T.push({
  id: 'glassCannon', name: '玻璃大炮', tier: 'normal', stackable: false, price: 150,
  desc: '攻击力+30%，但受到的伤害+10%。◇连携【求生本能】：取消受伤负面。',
  onBattle({ ally, run }) {
    ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.3, label: '玻璃大炮' })
    if (!hasT(run, 'survivalInstinct')) {
      ally.recvMults.push({ value: 1.1, label: '玻璃大炮' })
    }
  }
})

T.push({
  id: 'crashAmplifier', name: '崩溃放大', tier: 'normal', stackable: true, price: 120,
  desc: '心理崩溃瞬间造成的伤害+25%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.dealMults.push({
      value: 1 + 0.25 * stacks, label: '崩溃放大',
      cond: (dmg) => dmg.cause === 'crash' || dmg.cause === 'crashBonus'
    })
  }
})

T.push({
  id: 'trueSight', name: '真实视界', tier: 'normal', stackable: true, price: 90,
  desc: '真实伤害+30%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.dealMults.push({
      value: 1 + 0.3 * stacks, label: '真实视界',
      cond: (dmg) => dmg.type === DamageType.TRUE
    })
  }
})

// ── 普通转译器 · 基础组：防御生存 ────────────────────────

T.push({
  id: 'firewall', name: '防火墙', tier: 'normal', stackable: false, price: 120,
  desc: '每场战斗中，第一次受到的伤害-50%。',
  onBattle({ ally }) {
    ally.judges.push({
      priority: PRIORITY.MODIFY, label: '防火墙', uses: 1,
      apply: () => ({ mult: 0.5, event: { type: 'judgeProc', side: 'ally', label: '防火墙：伤害减半' } })
    })
  }
})

T.push({
  id: 'ups', name: '应急电源', tier: 'normal', stackable: false, price: 150,
  desc: '每场战斗中，生命首次低于50%时，恢复20%最大生命并获得1层护盾。',
  onBattle({ battle, ally }) {
    let used = false
    battle.on('takeDamage', ({ unit }) => {
      if (used || unit !== ally) return null
      const eff = computeEffAttrs(ally)
      if (ally.hp > 0 && ally.hp < eff.hp * 0.5) {
        used = true
        return [
          ...runHealPipeline(battle, ally, eff.hp * 0.2),
          addShieldLayers(ally, 1, '应急电源'),
          { type: 'judgeProc', side: 'ally', label: '应急电源：紧急供能' }
        ]
      }
      return null
    })
  }
})

T.push({
  id: 'autoPatch', name: '自动补丁', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗结束后，额外恢复5%最大生命。（可叠加）',
  onVictory({ stacks }) { return { healPct: 0.05 * stacks } }
})

T.push({
  id: 'phaseArmor', name: '相位装甲', tier: 'normal', stackable: false, price: 150,
  desc: '受到伤害时，20%概率完全闪避。',
  onBattle({ ally }) {
    ally.judges.push({
      priority: PRIORITY.DODGE, label: '相位装甲',
      apply: () => (rngChance(0.2)
        ? { zero: true, event: { type: 'judgeProc', side: 'ally', label: '相位装甲：闪避' } }
        : null)
    })
  }
})

T.push({
  id: 'thornsProtocol', name: '荆棘协议', tier: 'normal', stackable: false, price: 120,
  desc: '受到攻击时，对敌方反弹800点物理伤害（无论是否抵挡成功）。◇连携【蓄能壁垒】：反伤800→1800。',
  onBattle({ ally, run }) {
    const amount = hasT(run, 'barrierCharge') ? 1800 : 800
    ally.judges.push({
      priority: PRIORITY.REFLECT, label: '荆棘协议', stopOnZero: false,
      apply: () => ({ reflect: { amount }, event: { type: 'judgeProc', side: 'ally', label: '荆棘协议' } })
    })
  }
})

T.push({
  id: 'dmgCap', name: '伤害封顶', tier: 'normal', stackable: false, price: 150,
  desc: '单次受到的伤害不超过最大生命的20%。◇连携【要塞协议】：上限20%→15%。',
  onBattle({ ally, run }) {
    const capPct = hasT(run, 'fortressProtocol') ? 0.15 : 0.2
    ally.judges.push({
      priority: PRIORITY.MODIFY, label: '伤害封顶',
      apply: (_dmg, amount, defender) => {
        const cap = computeEffAttrs(defender).hp * capPct
        if (amount > cap) return { mult: cap / amount, event: { type: 'judgeProc', side: 'ally', label: '伤害封顶' } }
        return null
      }
    })
  }
})

T.push({
  id: 'barrierRegen', name: '屏障再生', tier: 'normal', stackable: false, price: 90,
  desc: '每回合开始时，获得300点屏障。◇连携【要塞协议】：再生量300→600。',
  onBattle({ battle, ally, run }) {
    const amount = hasT(run, 'fortressProtocol') ? 600 : 300
    battle.on('turnStart', () => (ally.hp > 0 ? addBarrier(ally, amount, '屏障再生') : null))
  }
})

T.push({
  id: 'cleanseProtocol', name: '净化协议', tier: 'normal', stackable: false, price: 90,
  desc: '每场战斗开始时，移除自身全部负向乘算修饰器。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      const before = ally.mods.length
      ally.mods = ally.mods.filter((m) => !(m.type === ModifierType.MULTIPLIER && m.value < 0))
      return { type: 'cleanse', side: 'ally', removed: before - ally.mods.length }
    })
  }
})

T.push({
  id: 'hpModule', name: '生命模组', tier: 'normal', stackable: false, price: 150,
  desc: '获得时，最大生命+15%（本局永久）。◇连携【凝血装甲】：其低血阈值放宽至60%。',
  onAcquire(run) { run.modMaxHp(1.15) }
})

T.push({
  id: 'adaptiveArmor', name: '自适应装甲', tier: 'normal', stackable: false, price: 120,
  desc: '受到物理伤害后，本场防御+200（最多3次）。',
  onBattle({ battle, ally }) {
    let count = 0
    battle.on('takeDamage', ({ unit, dmg }) => {
      if (unit !== ally || count >= 3) return null
      if (dmg?.type !== DamageType.PHYSICAL) return null
      count++
      ally.mods.push({ type: ModifierType.ADDITION, attr: 'def', value: 200, label: '自适应装甲' })
      return { type: 'buff', side: 'ally', label: `自适应装甲：防御+200（${count}/3）` }
    })
  }
})

// ── 普通转译器 · 基础组：节奏 ────────────────────────────

T.push({
  id: 'slowTempo', name: '后发制人', tier: 'normal', stackable: false, price: 90,
  desc: '后手行动时，本次行动效果+20%。',
  onBattle({ ally }) {
    ally.actionMults.push({
      label: '后发制人',
      cond: (b, u) => (b._order?.[0] && b._order[0] !== u ? 1.2 : null)
    })
  }
})

T.push({
  id: 'tieBreaker', name: '平局仲裁', tier: 'normal', stackable: false, price: 60,
  desc: '先后手平局时，不再重掷，直接判我方先手。◇连携【连胜势头】：平局取胜的当回合效果+30%。',
  onBattle({ ally }) {
    ally.flags.tieWin = true
  }
})

// ── 普通转译器 · 独立扩展组 ──────────────────────────────

T.push({
  id: 'moralePatch', name: '士气补丁', tier: 'normal', stackable: true, price: 90,
  desc: '每场战斗中，第一次治疗效果+50%。（可叠加）',
  onBattle({ ally, stacks }) {
    let used = false
    ally.healMults.push({
      value: 1 + 0.5 * stacks, label: '士气补丁',
      cond: () => { if (used) return false; used = true; return true }
    })
  }
})

T.push({
  id: 'coldBoot', name: '冷启动', tier: 'normal', stackable: false, price: 60,
  desc: '前2回合受到的伤害-10%；第3回合起造成的伤害+10%。',
  onBattle({ battle, ally }) {
    ally.recvMults.push({ value: 0.9, label: '冷启动', cond: () => battle.turn <= 2 })
    ally.dealMults.push({ value: 1.1, label: '冷启动', cond: () => battle.turn >= 3 })
  }
})

T.push({
  id: 'pingSweep', name: '轮询扫描', tier: 'normal', stackable: true, price: 90,
  desc: '每回合开始时，对敌方造成200点真实伤害。（可叠加）◇连携【衰变协议】：真伤+100/层。',
  onBattle({ battle, ally, run, stacks }) {
    const amount = (200 + (hasT(run, 'decayProtocol') ? 100 : 0)) * stacks
    battle.on('turnStart', () => {
      const foe = ally.foe
      if (foe && foe.hp > 0) {
        return runDamagePipeline(battle, ally, foe, { type: DamageType.TRUE, amount, cause: 'pingSweep' })
      }
      return null
    })
  }
})

T.push({
  id: 'leanBuild', name: '精简构组', tier: 'normal', stackable: false, price: 120,
  desc: '战斗开始时，若我方骰池少于8颗，本场攻击力+12%。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      if (ally.pool.length < 8) {
        ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.12, label: '精简构组' })
        return { type: 'buff', side: 'ally', label: '精简构组：攻击力+12%' }
      }
      return null
    })
  }
})

T.push({
  id: 'daemonProcess', name: '守护进程', tier: 'normal', stackable: false, price: 120,
  desc: '每场战斗开始时，获得2次重抽充能，但本场治疗效果-30%。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      ally.rerollCharges += 2
      ally.healMults.push({ value: 0.7, label: '守护进程' })
      return { type: 'info', text: '守护进程：重抽充能+2，治疗效果-30%' }
    })
  }
})

T.push({
  id: 'zeroCopy', name: '零拷贝', tier: 'normal', stackable: false, price: 150,
  desc: '攻击时，25%概率无视敌方护盾（次数盾）直接结算。',
  onBattle({ ally }) {
    ally.flags.zeroCopy = true
  }
})

T.push({
  id: 'gracefulDegrade', name: '优雅降级', tier: 'normal', stackable: true, price: 60,
  desc: '生命低于30%时，受到的伤害-8%。（可叠加）',
  onBattle({ ally, stacks }) {
    ally.recvMults.push({
      value: 1 - 0.08 * stacks, label: '优雅降级',
      cond: () => ally.hp > 0 && ally.hp < computeEffAttrs(ally).hp * 0.3
    })
  }
})

// ── 普通转译器 · 连携组：护盾屏障流 ──────────────────────

T.push({
  id: 'barrierCharge', name: '蓄能壁垒', tier: 'normal', stackable: false, price: 120,
  desc: '屏障存在期间，攻击力+15%。◇连携【荆棘协议】：其反伤800→1800；【热备援】：其开战屏障量+50%。',
  onBattle({ ally }) {
    ally.dynamicProviders.push((u) => (u.barrier > 0
      ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.15, label: '蓄能壁垒' }]
      : []))
  },
  synergy: {
    requires: ['thornsProtocol'],
    desc: '与荆棘协议/热备援同持时强化其数值（修正型联动，自动生效）'
  }
})

T.push({
  id: 'aegisDock', name: '神盾坞', tier: 'normal', stackable: false, price: 150,
  desc: '每回合开始时，若持有护盾层，获得300点屏障。◇连携【协变核心】：开战额外获得1层护盾。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      if (ally.hp > 0 && ally.shieldLayers > 0) return addBarrier(ally, 300, '神盾坞')
      return null
    })
  },
  synergy: {
    requires: ['covarianceCore'],
    desc: '与协变核心同持：开战额外获得1层护盾',
    onBattle({ battle, ally }) {
      battle.on('battleStart', () => addShieldLayers(ally, 1, '神盾坞·连携'))
    }
  }
})

T.push({
  id: 'fortressProtocol', name: '要塞协议', tier: 'normal', stackable: false, price: 150,
  desc: '每回合开始时，若没有护盾层，获得1层护盾。◇连携【屏障再生】：其再生量300→600；【伤害封顶】：其上限20%→15%。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      if (ally.hp > 0 && ally.shieldLayers <= 0) return addShieldLayers(ally, 1, '要塞协议')
      return null
    })
  },
  synergy: {
    requires: ['barrierRegen'],
    desc: '与屏障再生/伤害封顶同持时强化其数值（修正型联动，自动生效）'
  }
})

// ── 普通转译器 · 连携组：低血流 ──────────────────────────

T.push({
  id: 'survivalInstinct', name: '求生本能', tier: 'normal', stackable: false, price: 120,
  desc: '生命低于50%时，造成的伤害+20%。◇连携【玻璃大炮】：取消其受伤+10%负面，且低血伤害额外+15%。',
  onBattle({ ally }) {
    ally.dealMults.push({
      value: 1.2, label: '求生本能',
      cond: () => ally.hp > 0 && ally.hp < computeEffAttrs(ally).hp * 0.5
    })
  },
  synergy: {
    requires: ['glassCannon'],
    desc: '与玻璃大炮同持：低血伤害额外+15%（负面取消在玻璃大炮侧生效）',
    onBattle({ ally }) {
      ally.dealMults.push({
        value: 1.15, label: '求生本能·连携',
        cond: () => ally.hp > 0 && ally.hp < computeEffAttrs(ally).hp * 0.5
      })
    }
  }
})

T.push({
  id: 'lastStand', name: '背水一战', tier: 'normal', stackable: false, price: 150,
  desc: '生命低于25%时，获得20%闪避。◇连携【应急熔断】：其复活生命30%→60%，并附带2层护盾。',
  onBattle({ ally }) {
    ally.judges.push({
      priority: PRIORITY.DODGE, label: '背水一战',
      apply: () => {
        if (ally.hp > 0 && ally.hp < computeEffAttrs(ally).hp * 0.25 && rngChance(0.2)) {
          return { zero: true, event: { type: 'judgeProc', side: 'ally', label: '背水一战：闪避' } }
        }
        return null
      }
    })
  },
  synergy: {
    requires: ['fuseBreaker'],
    desc: '与应急熔断同持：复活强化（修正型联动，在应急熔断侧生效）'
  }
})

T.push({
  id: 'bloodArmor', name: '凝血装甲', tier: 'normal', stackable: false, price: 120,
  desc: '生命低于50%时，每回合开始获得攻击力×60%的屏障。◇连携【自动补丁】：战后恢复额外+10%；【生命模组】：低血阈值放宽至60%。',
  onBattle({ battle, ally, run }) {
    const th = hasT(run, 'hpModule') ? 0.6 : 0.5
    battle.on('turnStart', () => {
      const eff = computeEffAttrs(ally)
      if (ally.hp > 0 && ally.hp < eff.hp * th) return addBarrier(ally, eff.atk * 0.6, '凝血装甲')
      return null
    })
  },
  onVictory({ run }) {
    return hasT(run, 'autoPatch') ? { healPct: 0.10 } : null
  },
  synergy: {
    requires: ['autoPatch'],
    desc: '与自动补丁同持：战后恢复额外+10%（生命模组阈值联动为修正型）'
  }
})

// ── 普通转译器 · 连携组：心理流 ──────────────────────────

T.push({
  id: 'psyCatalyst', name: '心智催化', tier: 'normal', stackable: false, price: 120,
  desc: '敌方触发心理崩溃时，我方回复15%最大生命。◇连携【异常捕获】：其附加心理伤害10000→15000。',
  onBattle({ battle, ally }) {
    battle.on('crash', ({ unit }) => {
      if (unit !== ally && unit.hp > 0) {
        const eff = computeEffAttrs(ally)
        return [
          ...runHealPipeline(battle, ally, eff.hp * 0.15),
          { type: 'judgeProc', side: 'ally', label: '心智催化：回复15%生命' }
        ]
      }
      return null
    })
  },
  synergy: {
    requires: ['exceptionCatch'],
    desc: '与异常捕获同持：强化其附加伤害（修正型联动，在异常捕获侧生效）'
  }
})

T.push({
  id: 'nightmareEcho', name: '噩梦回响', tier: 'normal', stackable: false, price: 150,
  desc: '崩溃中的敌人每回合开始时，受到1000点心理伤害（生命伤害）。◇连携【崩溃利用】：对崩溃敌人增伤30%→50%。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      const foe = ally.foe
      if (foe && foe.hp > 0 && foe.crash) {
        return runDamagePipeline(battle, ally, foe, { type: DamageType.PSYCHIC, amount: 1000, cause: 'nightmareEcho' })
      }
      return null
    })
  },
  synergy: {
    requires: ['crashExploit'],
    desc: '与崩溃利用同持：增伤强化（修正型联动，在崩溃利用侧生效）'
  }
})

T.push({
  id: 'synapseBurn', name: '突触灼蚀', tier: 'normal', stackable: false, price: 120,
  desc: '敌方心理崩溃结束时，立即受到3000点心理伤害。◇连携【心理透镜】：其每层心理损伤加成15%→22%。',
  onBattle({ battle, ally }) {
    battle.on('crashEnd', ({ unit }) => {
      if (unit !== ally && unit.hp > 0) {
        return runDamagePipeline(battle, ally, unit, { type: DamageType.PSYCHIC, amount: 3000, cause: 'synapseBurn' })
      }
      return null
    })
  },
  synergy: {
    requires: ['psyLens'],
    desc: '与心理透镜同持：加成强化（修正型联动，在心理透镜侧生效）'
  }
})

// ── 普通转译器 · 连携组：骰池/连击流 ────────────────────

T.push({
  id: 'poolArchitect', name: '骰池架构', tier: 'normal', stackable: false, price: 150,
  desc: '骰池每超出10颗1颗，攻击力+3%（实时）。◇连携【栈溢出】：其计数阈值第7颗→第5颗；【虚拟内存】：骰池上限再+2。',
  onBattle({ ally }) {
    ally.dynamicProviders.push((u) => {
      const extra = Math.max(0, u.pool.length - 10)
      return extra > 0
        ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.03 * extra, label: '骰池架构' }]
        : []
    })
  },
  synergy: {
    requires: ['stackOverflow'],
    desc: '与栈溢出同持：阈值强化；与虚拟内存同持：上限再+2（修正型联动）'
  }
})

T.push({
  id: 'diceCurator', name: '骰子策展', tier: 'normal', stackable: false, price: 120,
  desc: '骰池中每存在1种不同的骰子类型（去重），攻击力+3%。◇连携【镜像池】：其镜像复制变为2颗。',
  onBattle({ ally }) {
    ally.dynamicProviders.push((u) => {
      const kinds = new Set(u.pool.map((d) => d.kinds.join(',')))
      return kinds.size > 0
        ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.03 * kinds.size, label: '骰子策展' }]
        : []
    })
  },
  synergy: {
    requires: ['mirrorPool'],
    desc: '与镜像池同持：复制数量强化（修正型联动，在镜像池侧生效）'
  }
})

T.push({
  id: 'consecBeacon', name: '连击信标', tier: 'normal', stackable: false, price: 120,
  desc: '连续抽出第3颗及以上同类型骰子时，回复攻击力×30%的生命。◇连携【连击引擎】：其第2颗增伤30%→45%；【尾递归优化】：其第3颗倍率×2→×2.5。',
  onBattle({ battle, ally }) {
    battle.on('actionResolved', ({ unit }) => {
      if (unit !== ally || ally.consecKindCount < 3) return null
      const eff = computeEffAttrs(ally)
      return [
        ...runHealPipeline(battle, ally, eff.atk * 0.3),
        { type: 'judgeProc', side: 'ally', label: '连击信标：回复' }
      ]
    })
  },
  synergy: {
    requires: ['comboEngine'],
    desc: '与连击引擎/尾递归优化同持：数值强化（修正型联动，在对侧生效）'
  }
})

T.push({
  id: 'fragileForge', name: '易碎熔炉', tier: 'normal', stackable: false, price: 120,
  desc: '所有易碎骰子的效果+25%。◇连携【骰子淬火】：被淬火保留的易碎骰效果+25%→+45%。',
  onBattle({ ally, run }) {
    const mult = hasT(run, 'dieHardening') ? 1.45 : 1.25
    ally.actionMults.push({
      label: '易碎熔炉',
      cond: (_b, _u, die) => (die.kinds.includes('FRAGILE_SELF') ? mult : null)
    })
  },
  synergy: {
    requires: ['dieHardening'],
    desc: '与骰子淬火同持：易碎骰增伤25%→45%（本体内已读取持有状态）'
  }
})

// ── 普通转译器 · 连携组：经济/节奏/异常流 ────────────────

T.push({
  id: 'fluxLens', name: '通量透镜', tier: 'normal', stackable: false, price: 150,
  desc: '开战时，每持有200通量攻击力+3%（上限15%，按开战时快照）。◇连携【复利计息】：其单次上限50→100。',
  onBattle({ battle, ally, run }) {
    battle.on('battleStart', () => {
      const bonus = Math.min(0.15, Math.floor(run.flux / 200) * 0.03)
      if (bonus > 0) {
        ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: bonus, label: '通量透镜' })
        return { type: 'buff', side: 'ally', label: `通量透镜：攻击力+${Math.round(bonus * 100)}%` }
      }
      return null
    })
  },
  synergy: {
    requires: ['compoundInterest'],
    desc: '与复利计息同持：上限强化（修正型联动，在复利计息侧生效）'
  }
})

T.push({
  id: 'angelInvestor', name: '天使投资', tier: 'normal', stackable: false, price: 90,
  desc: '每次在商店购买转译器后，下一场战斗攻击力+15%。◇连携【贪婪采样】：其商店折扣20%→30%。',
  synergy: {
    requires: ['greedySample'],
    desc: '与贪婪采样同持：商店折扣20%→30%（在商店侧生效）'
  }
})

T.push({
  id: 'luckyStreak', name: '连胜势头', tier: 'normal', stackable: false, price: 120,
  desc: '抢先手行动时，本次行动效果+15%。◇连携【平局仲裁】：平局取胜的当回合效果+30%。',
  onBattle({ ally }) {
    ally.actionMults.push({
      label: '连胜势头',
      cond: (b, u) => (b._order?.[0] === u ? (b._tieWonThisTurn ? 1.3 : 1.15) : null)
    })
  },
  synergy: {
    requires: ['tieBreaker'],
    desc: '与平局仲裁同持：平局取胜回合效果+30%（本体内已读取战斗状态）'
  }
})

T.push({
  id: 'rerollMastery', name: '重抽大师', tier: 'normal', stackable: false, price: 120,
  desc: '重抽后的新骰子，本次行动效果+25%。◇连携【量子重掷】：其每场次1→2；【频率偏移】：开战额外+1充能。',
  onBattle({ ally }) {
    ally.actionMults.push({
      label: '重抽大师',
      cond: (b) => (b._rerolledThisTurn ? 1.25 : null)
    })
  },
  synergy: {
    requires: ['quantumReroll'],
    desc: '与量子重掷/频率偏移同持：充能强化（修正型联动，在对侧生效）'
  }
})

T.push({
  id: 'decayProtocol', name: '衰变协议', tier: 'normal', stackable: false, price: 120,
  desc: '攻击附加"衰变"：敌方2回合内每回合开始受到500点真实伤害（每次行动至多附加一层）。◇连携【内存泄漏】：其灼烧比例1%→1.5%；【轮询扫描】：其扫描真伤+100/层。',
  onBattle({ ally }) {
    ally.flags.decayOnHit = 500
  },
  synergy: {
    requires: ['memLeak'],
    desc: '与内存泄漏/轮询扫描同持：数值强化（修正型联动，在对侧生效）'
  }
})

// ── 核心转译器 ──────────────────────────────────────────

T.push({
  id: 'entropyEngine', name: '熵减引擎', tier: 'core', stackable: false,
  desc: '常规：战斗开始时加入1颗5点攻击骰子。核心：骰池中每有1颗点数≥5的骰子，攻击力+2%。',
  onBattle({ battle, ally, slotted }) {
    battle.on('battleStart', () => {
      addDie(ally, createDie({ id: 'attack', pips: 5, kinds: ['ATTACK'], onRoll: [{ fx: 'attack' }] }))
      return { type: 'info', text: '熵减引擎：加入1颗5点攻击骰子' }
    })
    if (slotted) {
      ally.dynamicProviders.push((u) => {
        const n = u.pool.filter((d) => d.pips >= 5).length
        return n > 0
          ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.02 * n, label: '熵减引擎' }]
          : []
      })
    }
  }
})

T.push({
  id: 'boundPointer', name: '越界指针', tier: 'core', stackable: false,
  desc: '常规：攻击力+5%。核心：先后手判定时，我方骰子点数+2（仅用于先后手）。',
  onBattle({ ally, slotted }) {
    ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.05, label: '越界指针' })
    if (slotted) ally.flags.orderPipsBonus += 2
  }
})

T.push({
  id: 'covarianceCore', name: '协变核心', tier: 'core', stackable: false,
  desc: '常规：每场战斗开始时获得1层护盾。核心：治疗骰子的溢出治疗量转化为屏障；抽出屏障骰子时，额外获得相当于其屏障值30%的治疗。',
  onBattle({ battle, ally, slotted }) {
    battle.on('battleStart', () => addShieldLayers(ally, 1, '协变核心'))
    if (slotted) {
      ally.flags.healOverflowBarrier = true
      ally.flags.barrierDieHeal = true
    }
  }
})

T.push({
  id: 'cacheCoherence', name: '缓存一致性', tier: 'core', stackable: false,
  desc: '常规：攻击力+5%。核心：骰池中每颗攻击骰使攻击力+4%（实时）。',
  onBattle({ ally, slotted }) {
    ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.05, label: '缓存一致性' })
    if (slotted) {
      ally.dynamicProviders.push((u) => {
        const n = u.pool.filter((d) => d.kinds.includes('ATTACK')).length
        return n > 0
          ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.04 * n, label: '缓存一致性·核心' }]
          : []
      })
    }
  }
})

T.push({
  id: 'branchPredictor', name: '分支预测', tier: 'core', stackable: false,
  desc: '常规：每场战斗开始获得1次≤3点重抽充能。核心：手动重抽后新骰≥5点时，本次行动效果+30%。',
  onBattle({ battle, ally, slotted }) {
    battle.on('battleStart', () => {
      ally.rerollCharges += 1
      return { type: 'info', text: '分支预测：重抽充能+1' }
    })
    if (slotted) {
      ally.actionMults.push({
        label: '分支预测·核心',
        cond: (b) => (b._rerollHighPips ? 1.3 : null)
      })
    }
  }
})

T.push({
  id: 'memoryAlign', name: '内存对齐', tier: 'core', stackable: false,
  desc: '常规：获得时最大生命+10%（本局永久）。核心：治疗效果+25%，每场开始获得1层护盾。',
  onAcquire(run) { run.modMaxHp(1.1) },
  onBattle({ battle, ally, slotted }) {
    if (slotted) {
      ally.healMults.push({ value: 1.25, label: '内存对齐·核心' })
      battle.on('battleStart', () => addShieldLayers(ally, 1, '内存对齐·核心'))
    }
  }
})

T.push({
  id: 'outOfOrder', name: '乱序执行', tier: 'core', stackable: false,
  desc: '常规：攻击伤害+8%。核心：与上回合骰子类型不同时，本次行动效果+30%。',
  onBattle({ ally, slotted }) {
    ally.dealMults.push({ value: 1.08, label: '乱序执行', cond: (dmg) => dmg.cause === 'attack' })
    if (slotted) {
      ally.actionMults.push({
        label: '乱序执行·核心',
        cond: (_b, u, die) => (u.lastDieKind != null && die.kinds.join(',') !== u.lastDieKind ? 1.3 : null)
      })
    }
  }
})

T.push({
  id: 'deadCode', name: '死代码清除', tier: 'core', stackable: false,
  desc: '常规：每场开始摧毁敌方1颗随机骰子。核心：每回合开始20%概率摧毁敌方1颗随机骰子。',
  onBattle({ battle, ally, slotted }) {
    battle.on('battleStart', () => {
      const foe = ally.foe
      if (foe.pool.length > 0) {
        removeDie(foe, rngPick(foe.pool))
        return { type: 'info', text: '死代码清除：摧毁敌方1颗骰子' }
      }
      return null
    })
    if (slotted) {
      battle.on('turnStart', () => {
        if (ally.hp > 0 && ally.foe.pool.length > 0 && rngChance(0.2)) {
          removeDie(ally.foe, rngPick(ally.foe.pool))
          return { type: 'info', text: '死代码清除·核心：摧毁敌方1颗骰子' }
        }
        return null
      })
    }
  }
})

T.push({
  id: 'mutex', name: '互斥锁', tier: 'core', stackable: false,
  desc: '常规：屏障获取量+20%。核心：每场屏障首次被完全击破时，立即获得2层护盾。',
  onBattle({ ally, slotted }) {
    ally.barrierMult = (ally.barrierMult || 1) * 1.2
    if (slotted) ally.flags.mutexOnBreak = true
  }
})

// ── 高阶转译器（BOSS三选一） ─────────────────────────────

T.push({
  id: 'assertModule', name: '断言模块', tier: 'high', boss: 'verifier', stackable: false,
  desc: '攻击骰子伤害+30%。',
  onBattle({ ally }) {
    ally.dealMults.push({
      value: 1.3, label: '断言模块',
      cond: (dmg) => dmg.die?.kinds?.includes('ATTACK')
    })
  }
})

T.push({
  id: 'redundantCheck', name: '冗余校验', tier: 'high', boss: 'verifier', stackable: false,
  desc: '每场战斗中，前3次受到的伤害各减少40%。',
  onBattle({ ally }) {
    const judge = {
      priority: PRIORITY.MODIFY, label: '冗余校验', uses: 3,
      apply: () => ({ mult: 0.6, event: { type: 'judgeProc', side: 'ally', label: '冗余校验：伤害减少40%' } })
    }
    ally.judges.push(judge)
  }
})

T.push({
  id: 'exceptionCatch', name: '异常捕获', tier: 'high', boss: 'verifier', stackable: false,
  desc: '敌方触发心理崩溃时，额外受到10000点心理伤害，且崩溃效果持续时间+1回合。◇连携【心智催化】：附加伤害10000→15000。',
  onBattle({ battle, ally, run }) {
    const bonus = hasT(run, 'psyCatalyst') ? 15000 : 10000
    battle.on('crash', ({ unit }) => {
      if (unit !== ally && unit.hp > 0) {
        if (unit.crash) unit.crash.turns += 1
        return runDamagePipeline(battle, ally, unit, {
          type: DamageType.PSYCHIC, amount: bonus, cause: 'exceptionCatch'
        })
      }
      return null
    })
  }
})

T.push({
  id: 'tailCall', name: '尾递归优化', tier: 'high', boss: 'recursion', stackable: false,
  desc: '连续抽出第3颗及以上相同类型的骰子时，该骰子效果×2。◇连携【连击信标】：倍率×2→×2.5。',
  onBattle({ ally, run }) {
    const mult = hasT(run, 'consecBeacon') ? 2.5 : 2
    ally.actionMults.push({
      label: '尾递归优化',
      cond: (_b, u) => (u.consecKindCount >= 3 ? mult : null)
    })
  }
})

T.push({
  id: 'memLeak', name: '内存泄漏', tier: 'high', boss: 'recursion', stackable: false,
  desc: '敌方每回合开始时，受到相当于其最大生命值1%的真实伤害。◇连携【衰变协议】：灼烧比例1%→1.5%。',
  onBattle({ battle, ally, run }) {
    const pct = hasT(run, 'decayProtocol') ? 0.015 : 0.01
    battle.on('turnStart', () => {
      const enemy = ally.foe
      if (enemy && enemy.hp > 0) {
        const eff = computeEffAttrs(enemy)
        return runDamagePipeline(battle, ally, enemy, {
          type: DamageType.TRUE, amount: eff.hp * pct, cause: 'memLeak'
        })
      }
      return null
    })
  }
})

T.push({
  id: 'stackOverflow', name: '栈溢出', tier: 'high', boss: 'recursion', stackable: false,
  desc: '我方骰池中第7颗及以后的每颗骰子，使攻击力+8%。◇连携【骰池架构】：计数阈值第7颗→第5颗。',
  onBattle({ ally, run }) {
    const threshold = hasT(run, 'poolArchitect') ? 4 : 6
    ally.dynamicProviders.push((u) => {
      const extra = Math.max(0, u.pool.length - threshold)
      return extra > 0
        ? [{ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.08 * extra, label: '栈溢出' }]
        : []
    })
  }
})

T.push({
  id: 'nullMerge', name: '空值合并', tier: 'high', boss: 'nullref', stackable: false,
  desc: '抽出1点骰子时，重抽一次（每回合限1次）。',
  onBattle({ ally }) {
    ally.flags.autoRerollOnes = true
  }
})

T.push({
  id: 'lazyEval', name: '惰性求值', tier: 'high', boss: 'nullref', stackable: false,
  desc: '本场战斗中我方骰池内所有骰子的点数+1（含后续加入的骰子）。',
  onBattle({ ally }) {
    ally.flags.pipsBonus += 1
  }
})

T.push({
  id: 'shortCircuit', name: '短路求值', tier: 'high', boss: 'nullref', stackable: false,
  desc: '生命值首次低于25%时，立即获得相当于最大生命值30%的屏障。',
  onBattle({ battle, ally }) {
    let used = false
    battle.on('takeDamage', ({ unit }) => {
      if (used || unit !== ally) return null
      const eff = computeEffAttrs(ally)
      if (ally.hp > 0 && ally.hp < eff.hp * 0.25) {
        used = true
        return [
          addBarrier(ally, eff.hp * 0.3, '短路求值'),
          { type: 'judgeProc', side: 'ally', label: '短路求值：紧急屏障' }
        ]
      }
      return null
    })
  }
})

// ── 高阶转译器 · 校验者池扩充 ─────────────────────────────

T.push({
  id: 'invariant', name: '不变式断言', tier: 'high', boss: 'verifier', stackable: false,
  desc: '生命高于80%时，造成的伤害+40%。',
  onBattle({ ally }) {
    ally.dealMults.push({
      value: 1.4, label: '不变式断言',
      cond: () => ally.hp > computeEffAttrs(ally).hp * 0.8
    })
  }
})

T.push({
  id: 'fuzzGuard', name: '模糊守卫', tier: 'high', boss: 'verifier', stackable: false,
  desc: '每回合第一次受到的伤害不超过1500（每回合刷新）。',
  onBattle({ battle, ally }) {
    let turn = 0, used = false
    ally.judges.push({
      priority: PRIORITY.MODIFY, label: '模糊守卫',
      apply: (_dmg, amount) => {
        if (battle.turn !== turn) { turn = battle.turn; used = false }
        if (used || amount <= 1500) return null
        used = true
        return { mult: 1500 / amount, event: { type: 'judgeProc', side: 'ally', label: '模糊守卫：伤害限1500' } }
      }
    })
  }
})

T.push({
  id: 'canary', name: '金丝雀部署', tier: 'high', boss: 'verifier', stackable: false,
  desc: '每场战斗中，1次致命伤害归零，并以1点生命存活。',
  onBattle({ ally }) {
    let used = false
    ally.judges.push({
      priority: PRIORITY.MODIFY, label: '金丝雀部署',
      apply: (_dmg, amount, defender) => {
        if (used || defender.hp <= 0 || amount < defender.hp) return null
        used = true
        defender.hp = 1
        return { mult: 0, event: { type: 'judgeProc', side: 'ally', label: '金丝雀部署：致命伤归零' } }
      }
    })
  }
})

T.push({
  id: 'boundary', name: '边界值校验', tier: 'high', boss: 'verifier', stackable: false,
  desc: '6点骰子效果×1.5；抽出1点骰子时，获得1层护盾。',
  onBattle({ battle, ally }) {
    ally.actionMults.push({ label: '边界值校验', cond: (_b, _u, _d, pips) => (pips === 6 ? 1.5 : null) })
    battle.on('roll', () => {
      const die = battle._drawn.ally
      if (die && die.pips === 1) return addShieldLayers(ally, 1, '边界值校验')
      return null
    })
  }
})

T.push({
  id: 'typeCheck', name: '类型检查', tier: 'high', boss: 'verifier', stackable: false,
  desc: '攻击骰子有20%概率追加攻击力50%的法术伤害。',
  onBattle({ battle, ally }) {
    battle.on('actionResolved', ({ unit, die }) => {
      if (unit !== ally || !die?.kinds?.includes('ATTACK') || ally.foe.hp <= 0) return null
      if (!rngChance(0.2)) return null
      const eff = computeEffAttrs(ally)
      return runDamagePipeline(battle, ally, ally.foe, {
        type: DamageType.MAGIC, amount: eff.atk * 0.5, cause: 'typeCheck'
      })
    })
  }
})

// ── 高阶转译器 · 递归体池扩充 ─────────────────────────────

T.push({
  id: 'depthCharge', name: '递归深度', tier: 'high', boss: 'recursion', stackable: false,
  desc: '第3、6、9…回合开始时，攻击力+15%（本场永久叠加）。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      if (battle.turn % 3 === 0 && ally.hp > 0) {
        ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.15, label: '递归深度' })
        return { type: 'buff', side: 'ally', label: '递归深度：攻击力+15%' }
      }
      return null
    })
  }
})

T.push({
  id: 'memoize', name: '记忆化', tier: 'high', boss: 'recursion', stackable: false,
  desc: '抽出与上一回合相同类型的骰子时，该骰子效果×1.5。',
  onBattle({ ally }) {
    ally.actionMults.push({
      label: '记忆化',
      cond: (_b, u, die) => (u.lastDieKind != null && die.kinds.join(',') === u.lastDieKind ? 1.5 : null)
    })
  }
})

T.push({
  id: 'memoryCorrupt', name: '内存腐蚀', tier: 'high', boss: 'recursion', stackable: false,
  desc: '敌方每回合开始时，受到相当于其骰池数×300的真实伤害。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      const foe = ally.foe
      if (foe && foe.hp > 0) {
        return runDamagePipeline(battle, ally, foe, {
          type: DamageType.TRUE, amount: foe.pool.length * 300, cause: 'memoryCorrupt'
        })
      }
      return null
    })
  }
})

T.push({
  id: 'infiniteLoop', name: '死循环', tier: 'high', boss: 'recursion', stackable: false,
  desc: '第8回合起，每回合开始获得2层护盾。',
  onBattle({ battle, ally }) {
    battle.on('turnStart', () => {
      if (battle.turn >= 8 && ally.hp > 0) return addShieldLayers(ally, 2, '死循环')
      return null
    })
  }
})

T.push({
  id: 'tailChain', name: '尾链延续', tier: 'high', boss: 'recursion', stackable: false,
  desc: '连续抽出第3颗及以上同类型骰子时，额外回复攻击力×30%的生命。',
  onBattle({ battle, ally }) {
    battle.on('actionResolved', ({ unit }) => {
      if (unit !== ally || ally.consecKindCount < 3) return null
      const eff = computeEffAttrs(ally)
      return [
        ...runHealPipeline(battle, ally, eff.atk * 0.3),
        { type: 'judgeProc', side: 'ally', label: '尾链延续：回复' }
      ]
    })
  }
})

// ── 高阶转译器 · 空引用池扩充 ─────────────────────────────

T.push({
  id: 'optionalChain', name: '可选链', tier: 'high', boss: 'nullref', stackable: false,
  desc: '抽出1点骰子时，获得800点屏障。',
  onBattle({ battle, ally }) {
    battle.on('roll', () => {
      const die = battle._drawn.ally
      if (die && die.pips === 1) return addBarrier(ally, 800, '可选链')
      return null
    })
  }
})

T.push({
  id: 'nullGuard', name: '空值守卫', tier: 'high', boss: 'nullref', stackable: false,
  desc: '每回合首次受到伤害时，25%概率完全无效（每回合刷新）。',
  onBattle({ battle, ally }) {
    let turn = 0, used = false
    ally.judges.push({
      priority: PRIORITY.DODGE, label: '空值守卫',
      apply: () => {
        if (battle.turn !== turn) { turn = battle.turn; used = false }
        if (used) return null
        used = true
        if (rngChance(0.25)) {
          return { zero: true, event: { type: 'judgeProc', side: 'ally', label: '空值守卫：完全无效' } }
        }
        return null
      }
    })
  }
})

T.push({
  id: 'lazyProxy', name: '惰性代理', tier: 'high', boss: 'nullref', stackable: false,
  desc: '每场战斗中，我方第一次行动的效果×2。',
  onBattle({ ally }) {
    let used = false
    ally.actionMults.push({
      label: '惰性代理',
      cond: () => { if (used) return null; used = true; return 2 }
    })
  }
})

T.push({
  id: 'coalesce', name: '双问号合并', tier: 'high', boss: 'nullref', stackable: false,
  desc: '生命低于30%时，治疗效果+60%。',
  onBattle({ ally }) {
    ally.healMults.push({
      value: 1.6, label: '双问号合并',
      cond: (t) => t.hp < computeEffAttrs(t).hp * 0.3
    })
  }
})

T.push({
  id: 'dereference', name: '解引用', tier: 'high', boss: 'nullref', stackable: false,
  desc: '开战时：随机1颗敌方骰点数-2（最低1），随机1颗我方骰点数+2。',
  onBattle({ battle, ally }) {
    battle.on('battleStart', () => {
      const evs = []
      const foe = ally.foe
      if (foe.pool.length > 0) {
        const d = rngPick(foe.pool)
        d.pips = Math.max(1, d.pips - 2)
        evs.push({ type: 'info', text: `解引用：敌方1颗骰子降至${d.pips}点` })
      }
      if (ally.pool.length > 0) {
        const d = rngPick(ally.pool)
        d.pips = d.pips + 2
        evs.push({ type: 'info', text: `解引用：我方1颗骰子升至${d.pips}点` })
      }
      return evs
    })
  }
})

export const TRANSLATORS = Object.fromEntries(T.map((t) => [t.id, t]))
export const NORMAL_POOL = T.filter((t) => t.tier === 'normal')
export const BOSS_POOLS = {
  verifier: T.filter((t) => t.boss === 'verifier').map((t) => t.id),
  recursion: T.filter((t) => t.boss === 'recursion').map((t) => t.id),
  nullref: T.filter((t) => t.boss === 'nullref').map((t) => t.id)
}
