// 局内进程：行动线推进、虚质生成、战斗衔接（见《游戏玩法》《虚质图鉴》）
import { setRngState, rngState, rngInt, rngPick, seedRNG } from './rng.js'
import { createBattle } from './combat.js'
import { ModifierType } from './attributes.js'
import { OPERATORS } from '../data/operators.js'
import { WEAPONS } from '../data/weapons.js'
import { ENEMY_TEMPLATES, BOSSES } from '../data/enemies.js'
import { TRANSLATORS } from '../data/translators.js'
import { ALL_DICE } from '../data/diceDefs.js'

// 是否持有指定转译器（连携判定用）
export function hasTranslator(run, id) {
  return run.translators.some((t) => t.id === id)
}

// 行动线节点：5层一循环段（战斗→战斗→特殊→战斗→BOSS），特殊节点按段轮换
export function nodeAt(layer) {
  const pos = (layer - 1) % 5
  if (pos === 4) return 'BOSS'
  if (pos === 2) {
    const segment = Math.floor((layer - 1) / 5)
    return ['EVENT', 'SHOP', 'EVENT', 'REWARD'][segment % 4]
  }
  return 'BATTLE'
}

export function operatorOf(run) {
  return OPERATORS.find((o) => o.id === run.operatorId)
}

export function weaponOf(run) {
  return WEAPONS.find((w) => w.id === run.weaponId)
}

export function runMaxHp(run) {
  return Math.floor(operatorOf(run).hp * run.maxHpMult)
}

// run 工具方法（供事件/奖励使用）
export function attachRunHelpers(run) {
  run.healPct = (p) => { run.hp = Math.min(runMaxHp(run), run.hp + runMaxHp(run) * p) }
  run.modMaxHp = (m) => {
    run.maxHpMult *= m
    run.hp = Math.min(run.hp, runMaxHp(run))
  }
  run.modAtk = (bonus) => { run.atkBonus += bonus }
}

export function createRun(operatorId, weaponId) {
  seedRNG((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)
  const run = {
    v: 1,
    seed: rngState(),
    operatorId,
    weaponId,
    layer: 1,
    flux: 0,
    hp: null, // 首场战斗开始时初始化
    maxHpMult: 1,
    atkBonus: 0,
    permAtkBonus: 0, // 快速迭代累计
    translators: [],
    coreSlots: [null, null, null],
    extraDice: [], // 本局永久额外骰子（频谱探针/事件获得）
    reviveUsed: false,
    nextBattleMark: null, // {enemyHpMult, enemyAtkMult, fluxMult}
    _markFluxMult: 1,
    settings: { speed: 1, protocol: 'none', animSkip: false, mini: false, alwaysOnTop: false },
    stats: { kills: 0 }
  }
  run.hp = runMaxHp(run)
  attachRunHelpers(run)
  return run
}

// 构建干员战斗规格：干员+武器合并，骰池=武器初始骰+局内额外骰（点数随机分配）
export function buildAllySpec(run) {
  const op = operatorOf(run)
  const wpn = weaponOf(run)
  const pool = []
  for (const [kind, count] of Object.entries(wpn.dice)) {
    for (let i = 0; i < count; i++) {
      const pips = 1 + rngInt(6)
      const fxMap = { attack: 'attack', barrier: 'barrier', heal: 'heal' }
      const kindMap = { attack: ['ATTACK'], barrier: ['BARRIER'], heal: ['HEAL'] }
      pool.push({ id: kind, pips, kinds: kindMap[kind], onRoll: [{ fx: fxMap[kind] }] })
    }
  }
  for (const specialId of [...wpn.special, ...run.extraDice]) {
    const def = ALL_DICE[specialId]
    if (def) pool.push({ ...def })
  }
  const maxHp = runMaxHp(run)
  const atk = Math.floor((op.atk + wpn.atk) * (1 + run.atkBonus))
  return {
    name: op.name,
    title: op.title,
    attrs: {
      atk, hp: maxHp,
      def: 0, magicResist: 0,
      physPenPct: 0, magicPenPct: 0, physPenFlat: 0, magicPenFlat: 0,
      maxPsy: 1000, psychicResist: 0, damageResist: 0
    },
    pool,
    poolCap: 10 + (run.poolCapBonus || 0)
      + (hasTranslator(run, 'virtualMemory') && hasTranslator(run, 'poolArchitect') ? 2 : 0),
    desc: op.desc,
    setup(unit, battle) {
      op.setup?.(unit, battle)
      wpn.effect?.setup?.(unit, battle)
    }
  }
}

// 敌方数值全局倍率：大幅削弱虚质面板（生命/攻击/防御/抗性/心理阈值）
export const ENEMY_STAT_MULT = 0.5

// 生成虚质规格：普通模板按层数缩放，BOSS按轮换与循环倍率
export function generateEnemySpec(run) {
  const layer = run.layer
  let def, hp, atk
  if (nodeAt(layer) === 'BOSS') {
    const bossIndex = Math.floor(layer / 5) - 1
    def = BOSSES[bossIndex % BOSSES.length]
    const cycle = Math.floor(bossIndex / BOSSES.length)
    const mult = Math.pow(1.5, cycle)
    hp = def.attrs.hp * mult
    atk = def.attrs.atk * mult
  } else {
    const pool = ENEMY_TEMPLATES.filter((t) => t.minLayer <= layer)
    def = rngPick(pool)
    hp = def.attrs.hp * (1 + 0.1 * layer)
    atk = def.attrs.atk * (1 + 0.06 * layer)
  }
  // 平行样本/虚空低语标记
  const mark = run.nextBattleMark
  if (mark?.enemyHpMult) hp *= mark.enemyHpMult
  if (mark?.enemyAtkMult) atk *= mark.enemyAtkMult
  run._markFluxMult = mark?.fluxMult ?? 1
  run.nextBattleMark = null

  // 构建骰池
  const dice = []
  const spec = def.pool || {}
  const kindMap = { attack: ['ATTACK'], barrier: ['BARRIER'], heal: ['HEAL'] }
  for (const [kind, count] of Object.entries(spec)) {
    if (kind === 'special') {
      for (const id of count) { const d = ALL_DICE[id]; if (d) dice.push({ ...d }) }
    } else {
      for (let i = 0; i < count; i++) {
        dice.push({ id: kind, pips: 1 + rngInt(6), kinds: kindMap[kind], onRoll: [{ fx: kind }] })
      }
    }
  }
  return {
    id: def.id,
    name: def.name,
    attrs: {
      atk: Math.floor(atk * ENEMY_STAT_MULT), hp: Math.floor(hp * ENEMY_STAT_MULT),
      def: Math.floor(def.attrs.def * ENEMY_STAT_MULT),
      magicResist: Math.floor(def.attrs.magicResist * ENEMY_STAT_MULT),
      physPenPct: 0, magicPenPct: 0, physPenFlat: 0, magicPenFlat: 0,
      maxPsy: Math.floor(def.attrs.maxPsy * ENEMY_STAT_MULT),
      psychicResist: Math.floor(def.attrs.psychicResist * ENEMY_STAT_MULT),
      damageResist: Math.floor(def.attrs.damageResist * ENEMY_STAT_MULT)
    },
    pool: dice,
    desc: def.desc,
    setup: def.setup,
    clampAllyPips: def.clampAllyPips || null
  }
}

// 开始一场战斗
export function startBattle(run) {
  setRngState(run.rngState ?? run.seed)
  const allySpec = buildAllySpec(run)
  const enemySpec = generateEnemySpec(run)
  const battle = createBattle({
    allySpec,
    enemySpec,
    permAtkMult: 1 + run.permAtkBonus,
    onSetup(b) {
      for (const t of run.translators) {
        const td = TRANSLATORS[t.id]
        if (!td?.onBattle) continue
        td.onBattle({
          battle: b,
          ally: b.ally,
          stacks: t.stacks,
          slotted: td.tier === 'core' ? run.coreSlots.includes(t.id) : true,
          run
        })
      }
      // 连携转译器：requires 全部持有时，额外激活质变效果（修正型联动在对应转译器内读取持有状态）
      for (const t of run.translators) {
        const td = TRANSLATORS[t.id]
        if (!td?.synergy?.onBattle) continue
        if (td.synergy.requires.every((id) => run.translators.some((x) => x.id === id))) {
          td.synergy.onBattle({ battle: b, ally: b.ally, stacks: t.stacks, run })
        }
      }
      // 天使投资：购买转译器后的下一场战斗攻击力+15%
      if (run.buffNextBattle) {
        b.ally.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: 0.15, label: '天使投资' })
        run.buffNextBattle = false
      }
    }
  })
  battle.ally.hp = Math.min(run.hp, battle.ally.attrs.hp)
  battle.enemySpecId = enemySpec.id
  return { battle, enemySpec }
}

// 战斗胜利结算：通量、治疗、成长（转译器战后钩子 onVictory → {flux, healPct, permAtk}）
export function afterBattleVictory(run, battle) {
  run.stats.kills++
  // 通量奖励：20 + 4×层数，通量虹吸+10%/层，标记倍率
  const siphon = run.translators.find((t) => t.id === 'fluxSiphon')?.stacks || 0
  let flux = Math.round((20 + 4 * run.layer) * (1 + 0.1 * siphon) * (run._markFluxMult || 1))
  run._markFluxMult = 1
  let healPct = 0.1
  let permAtk = 0
  // 转译器战后钩子（编译缓存/复利计息/协同基金/自动补丁/快速迭代等）
  for (const t of run.translators) {
    const v = TRANSLATORS[t.id]?.onVictory?.({ run, battle, stacks: t.stacks })
    if (!v) continue
    if (v.flux) flux += Math.round(v.flux)
    if (v.healPct) healPct += v.healPct
    if (v.permAtk) permAtk += v.permAtk
  }
  // 骰子通量标记（赏金骰/废料骰）
  flux += battle._bonusFlux || 0
  run.flux += flux
  const maxHp = runMaxHp(run)
  const healed = Math.min(maxHp - battle.ally.hp, maxHp * healPct)
  run.hp = Math.min(maxHp, battle.ally.hp + maxHp * healPct)
  if (permAtk > 0) run.permAtkBonus += permAtk
  return { flux, healed }
}

// 战斗失败时同步生命
export function afterBattleDefeat(run, battle) {
  run.hp = battle.ally.hp
}

// 推进层数
export function advanceLayer(run) {
  run.layer++
  return run.layer
}

// 序列化/反序列化（存档）
export function serializeRun(run) {
  const { healPct, modMaxHp, modAtk, ...rest } = run
  void healPct; void modMaxHp; void modAtk
  return { ...rest, rngState: rngState() }
}

export function deserializeRun(data) {
  const run = { ...data }
  const s = { speed: 1, protocol: 'none', animSkip: false, mini: false, alwaysOnTop: false, ...(run.settings || {}) }
  // 兼容旧存档：settings.auto 布尔 → protocol
  if (s.auto === true && s.protocol === 'none') s.protocol = 'auto'
  delete s.auto
  run.settings = s
  attachRunHelpers(run)
  return run
}
