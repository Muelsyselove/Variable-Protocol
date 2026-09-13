// 战斗引擎：五阶段回合状态机（见《战斗》）
import { computeEffAttrs, tickMods } from './attributes.js'
import { ModifierType } from './attributes.js'
import { basicDamage, DamageType } from './damage.js'
import { createDie, addDie, removeDie, effectCoef, isKind } from './dice.js'
import { addBarrier, addShieldLayers, installBlockJudges, runDamagePipeline, runHealPipeline, PRIORITY } from './judgment.js'
import { applyPsychicDamage, tickPsychology } from './psychology.js'
import { rng, rngDraw, rngPick, rngChance } from './rng.js'

// 构建战斗单位
export function createUnit(spec) {
  const unit = {
    side: spec.side,
    name: spec.name,
    title: spec.title || '',
    attrs: { ...spec.attrs },
    hp: spec.attrs.hp,
    mods: [],
    dynamicProviders: [],
    dealMults: [],
    recvMults: [],
    healMults: [],
    judges: [],
    actionMults: [],
    shieldLayers: 0,
    barrier: 0,
    barrierMult: 1,
    fragile: 0,
    fragileImmune: false,
    paralysis: 0,
    pendingParalysis: 0,
    psychicPool: 0,
    crash: null,
    actionDmg: null,
    onHitExtra: null,
    dots: [], // 持续伤害（衰变）：{amount, turns}
    hots: [], // 持续回复（再生）：{amount, turns}
    pool: [],
    poolCap: spec.poolCap ?? 10,
    lastDieKind: null,
    consecKind: null,
    consecKindCount: 0,
    rerollCharges: 0,
    psychicBonus: 0,
    flags: {
      noHealDice: false,
      healOverflowBarrier: false,
      barrierDieHeal: false,
      pipsBonus: 0,
      orderPipsBonus: 0,
      autoRerollOnes: false,
      crashBonus: false,
      reviveAvailable: false,
      reviveHpPct: null, // 应急熔断复活比例（背水一战连携改写）
      reviveShields: 0, // 复活时附带护盾层数
      loadedFirst: false, // 灌铅骰子
      fragileKeep: false, // 骰子淬火：易碎骰不离池
      tieWin: false, // 平局仲裁
      rerollAnyCharges: 0, // 量子重掷：不限点数重抽
      decayOnHit: 0, // 衰变协议：攻击附加衰变的每回合真伤
      zeroCopy: false, // 零拷贝：概率无视护盾
      mutexOnBreak: false // 互斥锁（核心效果）
    },
    foe: null
  }
  installBlockJudges(unit)
  // 初始骰池直接入池：骰池上限仅约束战斗中后续加入的骰子
  for (const def of spec.pool || []) unit.pool.push(createDie(def))
  return unit
}

// 创建战斗：opts = { allySpec, enemySpec, run }
export function createBattle(opts) {
  const battle = {
    ally: createUnit({ ...opts.allySpec, side: 'ally' }),
    enemy: createUnit({ ...opts.enemySpec, side: 'enemy' }),
    turn: 0,
    over: null, // 'victory' | 'defeat'
    waiting: null, // 等待玩家决策（重抽等）
    phase: 'battleStart',
    _drawn: { ally: null, enemy: null },
    _order: [],
    _actionIdx: 0,
    _manualRerollUsed: false,
    _autoRerollUsed: false,
    _tieGuard: 0,
    _bonusFlux: 0, // 战后额外通量（赏金骰/废料骰等）
    _loadedUsed: false, // 灌铅骰子：每场一次
    _rerolledThisTurn: false, // 本回合发生过重抽（重抽大师）
    _rerollHighPips: false, // 重抽后新骰≥5点（分支预测核心效果）
    _tieWonThisTurn: false, // 本回合平局仲裁取胜（连胜势头连携）
    _listeners: {},
    _permAtkMult: opts.permAtkMult || 1
  }
  battle.ally.foe = battle.enemy
  battle.enemy.foe = battle.ally

  battle.on = (ev, fn) => {
    (battle._listeners[ev] = battle._listeners[ev] || []).push(fn)
  }
  battle.emit = (ev, data) => {
    // 监听器可返回事件对象（或数组），注入当前步骤的事件流
    const out = []
    for (const fn of battle._listeners[ev] || []) {
      const r = fn(data)
      if (r) out.push(...(Array.isArray(r) ? r : [r]))
    }
    return out
  }

  // 局内永久攻击力加成（快速迭代）
  if (battle._permAtkMult !== 1) {
    battle.ally.mods.push({
      type: ModifierType.MULTIPLIER, attr: 'atk',
      value: battle._permAtkMult - 1, label: '快速迭代'
    })
  }
  // 空引用：我方抽出骰子点数钳制
  battle._clampAllyPips = opts.enemySpec.clampAllyPips || null
  battle._allyPipsOverride = null
  // 干员/武器/虚质能力与转译器钩子（setup 接收 unit 与 battle）
  opts.allySpec.setup?.(battle.ally, battle)
  opts.enemySpec.setup?.(battle.enemy, battle)
  opts.onSetup?.(battle)
  return battle
}

// 前进一步（原子步骤），返回 { events, waiting, over }
export function battleStep(battle) {
  const events = []
  switch (battle.phase) {
    case 'battleStart':
      battle.phase = 'turnStart'
      events.push({ type: 'battleStart' })
      events.push(...battle.emit('battleStart', { battle }))
      checkDeaths(battle, events)
      break

    case 'turnStart': {
      battle.turn++
      events.push({ type: 'turn', turn: battle.turn })
      // 僵局裁决：300回合未分胜负，判定干员消耗战获胜
      if (battle.turn > 300) {
        battle.over = 'victory'
        events.push({ type: 'stalemate' })
        events.push({ type: 'victory' })
        events.push(...battle.emit('battleEnd', { battle, winner: 'ally' }))
        break
      }
      tickUnitStart(battle, battle.ally, events)
      tickUnitStart(battle, battle.enemy, events)
      events.push(...battle.emit('turnStart', { battle, turn: battle.turn }))
      if (!checkDeaths(battle, events)) battle.phase = 'roll'
      break
    }

    case 'roll': {
      // 麻痹：消耗1层，跳过掷骰与行动
      drawForUnit(battle, battle.ally, events)
      drawForUnit(battle, battle.enemy, events)
      events.push(...battle.emit('roll', { battle }))
      // 自动重抽（奇偶/空值合并：抽出1点时重抽一次，每回合限1次）
      autoRerollOnes(battle, events)
      // 手动重抽（偏移/频率偏移）
      const opts = manualRerollOptions(battle)
      if (opts.length > 0) {
        battle.waiting = { type: 'reroll', options: opts }
        battle.phase = 'rerollWait'
      } else {
        battle.phase = 'order'
      }
      break
    }

    case 'rerollWait':
      // 等待 chooseReroll() 推进
      break

    case 'order': {
      const a = battle._drawn.ally
      const e = battle._drawn.enemy
      if (!a && !e) {
        battle.phase = 'turnEnd' // 双方均麻痹
      } else if (!a) {
        battle._order = [battle.enemy]
        battle.phase = 'action'; battle._actionIdx = 0
        events.push({ type: 'order', first: 'enemy', reason: 'paralysis' })
      } else if (!e) {
        battle._order = [battle.ally]
        battle.phase = 'action'; battle._actionIdx = 0
        events.push({ type: 'order', first: 'ally', reason: 'paralysis' })
      } else {
        const ap = orderPips(battle, battle.ally, a)
        const ep = orderPips(battle, battle.enemy, e)
        if (ap === ep && battle._tieGuard < 50) {
          if (battle.ally.flags.tieWin) {
            // 平局仲裁：不再重掷，直接判我方先手
            battle._tieWonThisTurn = true
            battle._order = [battle.ally, battle.enemy]
            battle.phase = 'action'; battle._actionIdx = 0
            events.push({ type: 'order', first: 'ally', ap, ep, reason: 'tieBreaker' })
          } else {
            // 平局：双方重掷，以最新结果为准
            battle._tieGuard++
            battle._drawn.ally = null
            battle._drawn.enemy = null
            events.push({ type: 'tieReroll' })
            battle.phase = 'roll'
          }
        } else {
          const first = ap > ep ? battle.ally : battle.enemy
          battle._order = first === battle.ally ? [battle.ally, battle.enemy] : [battle.enemy, battle.ally]
          battle.phase = 'action'; battle._actionIdx = 0
          events.push({ type: 'order', first: first.side, ap, ep })
        }
      }
      break
    }

    case 'action': {
      const unit = battle._order[battle._actionIdx]
      const die = battle._drawn[unit.side]
      if (unit && unit.hp > 0) {
        resolveAction(battle, unit, die, events)
        if (!checkDeaths(battle, events)) {
          battle._actionIdx++
          if (battle._actionIdx >= battle._order.length) battle.phase = 'turnEnd'
        }
      } else {
        battle._actionIdx++
        if (battle._actionIdx >= battle._order.length) battle.phase = 'turnEnd'
      }
      break
    }

    case 'turnEnd':
      battle._drawn = { ally: null, enemy: null }
      battle._autoRerollUsed = false
      battle._allyPipsOverride = null
      battle._tieGuard = 0
      battle._rerolledThisTurn = false
      battle._rerollHighPips = false
      battle._tieWonThisTurn = false
      events.push({ type: 'turnEnd', turn: battle.turn })
      events.push(...battle.emit('turnEnd', { battle, turn: battle.turn }))
      battle.phase = 'turnStart'
      break
  }
  return { events, waiting: battle.waiting, over: battle.over }
}

// 玩家决策：保留（null）或使用第 i 个重抽选项
export function chooseReroll(battle, index) {
  if (!battle.waiting || battle.waiting.type !== 'reroll') return []
  const opt = index == null ? null : battle.waiting.options[index]
  battle.waiting = null
  battle.phase = 'order'
  if (opt) {
    opt.consume?.()
    battle._drawn.ally = rngDraw(battle.ally.pool) || null
    applyAllyClamp(battle)
    // 重抽追踪（重抽大师/分支预测）
    battle._rerolledThisTurn = true
    if ((battle._drawn.ally?.pips || 0) >= 5) battle._rerollHighPips = true
    return [{
      type: 'reroll', side: 'ally', source: opt.label,
      pips: battle._drawn.ally?.pips, uid: battle._drawn.ally?.uid
    }]
  }
  return []
}

// 空引用：我方骰子点数钳制（先后手与效果均按钳制值计算）；灌铅骰子：低点提点
function applyAllyClamp(battle) {
  const die = battle._drawn.ally
  battle._allyPipsOverride = null
  if (!die) return
  // 灌铅骰子：每场首次抽出≤2点骰时，本次有效点数视为4
  if (battle.ally.flags.loadedFirst && !battle._loadedUsed && die.pips <= 2) {
    battle._loadedUsed = true
    battle._allyPipsOverride = 4
    return
  }
  if (battle._clampAllyPips && die.pips >= battle._clampAllyPips + 1) {
    battle._allyPipsOverride = battle._clampAllyPips
  }
}

// 我方骰子的有效点数（含钳制）
function allyPips(battle, die) {
  return battle._allyPipsOverride ?? die.pips
}

function orderPips(battle, unit, die) {
  const base = unit.side === 'ally' ? allyPips(battle, die) : die.pips
  return base + (unit.flags.orderPipsBonus || 0)
}

function drawForUnit(battle, unit, events) {
  if (unit.paralysis > 0) {
    unit.paralysis--
    battle._drawn[unit.side] = null
    events.push({ type: 'paralyzed', side: unit.side, layers: unit.paralysis })
    return
  }
  if (unit.pool.length === 0) {
    battle._drawn[unit.side] = null
    events.push({ type: 'noDice', side: unit.side })
    return
  }
  const die = rngDraw(unit.pool)
  battle._drawn[unit.side] = die
  events.push({ type: 'draw', side: unit.side, pips: die.pips, name: die.defId, uid: die.uid })
  if (unit.side === 'ally') applyAllyClamp(battle)
}

function autoRerollOnes(battle, events) {
  const die = battle._drawn.ally
  if (!die || battle._autoRerollUsed) return
  if (!battle.ally.flags.autoRerollOnes) return
  if (die.pips !== 1) return
  battle._autoRerollUsed = true
  battle._drawn.ally = rngDraw(battle.ally.pool)
  events.push({ type: 'reroll', side: 'ally', source: '低值重抽', pips: battle._drawn.ally?.pips })
}

function manualRerollOptions(battle) {
  const opts = []
  const die = battle._drawn.ally
  if (!die) return opts
  // 偏移：每场战斗1次
  if (!battle._manualRerollUsed && battle.ally.flags.manualReroll) {
    opts.push({
      label: '相位重掷', consume: () => {
        battle._manualRerollUsed = true
      }
    })
  }
  // 频率偏移：充能次数，抽出≤3点可用
  if (battle.ally.rerollCharges > 0 && die.pips <= 3) {
    opts.push({
      label: '频率偏移', consume: () => { battle.ally.rerollCharges-- }
    })
  }
  // 量子重掷：不限点数，每场充能次数
  if (battle.ally.flags.rerollAnyCharges > 0) {
    opts.push({
      label: '量子重掷', consume: () => { battle.ally.flags.rerollAnyCharges-- }
    })
  }
  return opts
}

// 回合开始的单位计时
function tickUnitStart(battle, unit, events) {
  const expiredMods = tickMods(unit)
  for (const m of expiredMods) events.push({ type: 'modExpire', side: unit.side, label: m.label })
  // 临时骰子计时
  const kept = []
  for (const die of unit.pool) {
    if (die.remaining > 0) {
      die.remaining--
      if (die.remaining <= 0) {
        events.push({ type: 'tempDieExpire', side: unit.side, pips: die.pips })
        continue
      }
    }
    kept.push(die)
  }
  unit.pool = kept
  const hadCrash = !!unit.crash
  tickPsychology(unit, events)
  // 崩溃结束事件（突触灼蚀等钩子）
  if (hadCrash && !unit.crash) {
    events.push(...battle.emit('crashEnd', { battle, unit }))
  }
  // 持续伤害（衰变协议等）：回合开始结算真伤
  if (unit.dots.length > 0) {
    const remain = []
    for (const d of unit.dots) {
      if (unit.hp > 0) {
        events.push(...runDamagePipeline(battle, unit.foe, unit, {
          type: DamageType.TRUE, amount: d.amount, cause: 'decay', depth: 1
        }))
      }
      d.turns--
      if (d.turns > 0) remain.push(d)
    }
    unit.dots = remain
  }
  // 持续回复（再生骰等）：回合开始结算治疗
  if (unit.hots.length > 0) {
    const remain = []
    for (const h of unit.hots) {
      events.push(...runHealPipeline(battle, unit, h.amount))
      h.turns--
      if (h.turns > 0) remain.push(h)
    }
    unit.hots = remain
  }
}

// 攻击段结算：支持 dtype（法伤/真伤）、flat（固伤）、hpScale（按损血增伤）、
// hpBelow/boostMult（自身低血强化）、foeBelow/foeMult（斩杀）、firstMover（抢先手）、lifesteal（吸血）、repeat（多段）
function attackSegment(battle, unit, foe, fx, die, coef, actionMult, eff, events) {
  let mult = fx.mult || 1
  if (fx.hpScale) {
    // 按已损生命增伤：每损失10%生命 +hpScale
    const missing = Math.max(0, 1 - unit.hp / computeEffAttrs(unit).hp)
    mult *= 1 + Math.floor(missing * 10) * fx.hpScale
  }
  if (fx.hpBelow != null && fx.boostMult != null && unit.hp < computeEffAttrs(unit).hp * fx.hpBelow) {
    mult = fx.boostMult
  }
  if (fx.foeBelow != null && fx.foeMult != null && foe.hp > 0 && foe.hp < computeEffAttrs(foe).hp * fx.foeBelow) {
    mult *= fx.foeMult
  }
  if (fx.firstMover && battle._order?.[0] === unit) mult *= fx.firstMover
  const A = fx.flat != null ? fx.flat : basicDamage(eff.atk, coef * mult)
  const tags = []
  if (unit.flags.zeroCopy && rngChance(0.25)) tags.push('pierceShield')
  const evs = runDamagePipeline(battle, unit, foe, {
    type: fx.dtype || DamageType.PHYSICAL, amount: A * actionMult, die, cause: 'attack', tags
  })
  events.push(...evs)
  if (fx.lifesteal && (evs.dealt || 0) > 0) {
    events.push(...runHealPipeline(battle, unit, evs.dealt * fx.lifesteal))
  }
}

// 行动结算：按骰子类型执行效果
function resolveAction(battle, unit, die, events) {
  events.push(...battle.emit('action', { battle, unit, die }))
  if (!die) { events.push({ type: 'skip', side: unit.side }); return }

  const foe = unit.foe
  const rawPips = unit.side === 'ally' ? allyPips(battle, die) : die.pips
  const pips = rawPips + (unit.flags.pipsBonus || 0)
  const coef = effectCoef(pips)

  // 混沌崩溃：行动时受到心理伤害
  if (unit.actionDmg) {
    events.push(...runDamagePipeline(battle, foe, unit, {
      type: DamageType.PSYCHIC, amount: unit.actionDmg.amount, cause: 'chaos'
    }))
    if (unit.hp <= 0) return
  }

  // 连续同类骰子追踪（先于效果倍率计算，尾递归优化依赖含当次的计数）
  if (die.kinds.join(',') === unit.consecKind) unit.consecKindCount++
  else { unit.consecKind = die.kinds.join(','); unit.consecKindCount = 1 }

  // 行动效果倍率（瞬态/深渊回响/尾递归等：cond 返回数值或 null）
  let actionMult = 1
  for (const m of unit.actionMults || []) {
    const r = m.cond ? m.cond(battle, unit, die, pips) : true
    if (r === true) actionMult *= m.mult || 1
    else if (typeof r === 'number' && r !== null) actionMult *= r
  }

  const eff = computeEffAttrs(unit)
  let attacked = false

  for (const fx of die.onRoll) {
    switch (fx.fx) {
      case 'attack': {
        const segs = fx.repeat || 1
        for (let s = 0; s < segs; s++) {
          if (foe.hp <= 0) break
          attackSegment(battle, unit, foe, fx, die, coef, actionMult, eff, events)
          attacked = true
        }
        break
      }
      case 'barrier': {
        let mult = fx.mult || 1
        // 凝血盾骰：屏障系数按已损生命提升
        if (fx.hemoScale) {
          const missing = Math.max(0, 1 - unit.hp / computeEffAttrs(unit).hp)
          mult = Math.min(fx.hemoScale.cap || 2, fx.hemoScale.base + Math.floor(missing * 10) * fx.hemoScale.perStep)
        }
        if (fx.hpBelow != null && fx.boostMult != null && unit.hp < computeEffAttrs(unit).hp * fx.hpBelow) {
          mult = fx.boostMult
        }
        events.push(addBarrier(unit, eff.atk * coef * mult * actionMult, '屏障骰'))
        // 协变核心：屏障骰额外治疗30%
        if (unit.flags.barrierDieHeal) {
          events.push(...runHealPipeline(battle, unit, eff.atk * coef * 0.3 * actionMult))
        }
        break
      }
      case 'heal': {
        events.push(...runHealPipeline(battle, unit, eff.atk * coef * (fx.mult || 1) * actionMult))
        break
      }
      case 'psychic': {
        events.push(...applyPsychicDamage(battle, unit, foe, fx.amount * (fx.mult || 1) * actionMult, fx.ptype))
        break
      }
      case 'selfAtk': {
        unit.mods.push({
          type: ModifierType.MULTIPLIER, attr: 'atk',
          value: fx.mult, label: fx.label || '强化骰子'
        })
        events.push({ type: 'buff', side: unit.side, label: fx.label || `攻击力+${Math.round(fx.mult * 100)}%` })
        break
      }
      case 'modFoeAtk': {
        foe.mods.push({
          type: ModifierType.MULTIPLIER, attr: 'atk',
          value: fx.mult, label: fx.label || '侵蚀'
        })
        events.push({ type: 'debuff', side: foe.side, label: fx.label || `攻击力${Math.round(fx.mult * 100)}%` })
        break
      }
      case 'addDie': {
        const created = createDie({ id: fx.def, ...fx.defSpec })
        const ok = addDie(fx.target === 'foe' ? foe : unit, created)
        events.push({
          type: ok ? 'dieAdded' : 'dieAddFail', side: fx.target === 'foe' ? foe.side : unit.side,
          pips: created.pips, name: created.defId
        })
        break
      }
      case 'cleanse': {
        const before = unit.mods.length
        unit.mods = unit.mods.filter((m) => !(m.type === ModifierType.MULTIPLIER && m.value < 0))
        events.push({ type: 'cleanse', side: unit.side, removed: before - unit.mods.length })
        break
      }
      case 'shield': {
        const ev = addShieldLayers(unit, fx.layers || 1, fx.label || '护盾骰')
        if (ev) events.push(ev)
        break
      }
      case 'fragile': {
        if (!foe.fragileImmune) {
          foe.fragile += fx.amount
          events.push({ type: 'debuff', side: foe.side, label: `脆弱+${Math.round(fx.amount * 100)}%` })
        } else {
          events.push({ type: 'judgeProc', side: foe.side, label: '目标免疫脆弱' })
        }
        break
      }
      case 'paralyze': {
        foe.pendingParalysis += fx.layers || 1
        events.push({ type: 'paralysis', side: foe.side, layers: foe.paralysis + foe.pendingParalysis, gain: fx.layers || 1 })
        break
      }
      case 'vuln': {
        foe.recvMults.push({ value: 1 + fx.mult, turns: fx.turns || 2, label: fx.label || '易伤' })
        events.push({ type: 'debuff', side: foe.side, label: `${fx.label || '易伤'}+${Math.round(fx.mult * 100)}%（${fx.turns || 2}回合）` })
        break
      }
      case 'dispel': {
        const before = foe.mods.length
        foe.mods = foe.mods.filter((m) => !(m.type === ModifierType.MULTIPLIER && m.value > 0))
        events.push({ type: 'dispel', side: foe.side, removed: before - foe.mods.length })
        break
      }
      case 'penetrate': {
        const map = { physPct: 'physPenPct', magicPct: 'magicPenPct', physFlat: 'physPenFlat', magicFlat: 'magicPenFlat' }
        for (const [k, attr] of Object.entries(map)) {
          if (fx[k]) unit.mods.push({ type: ModifierType.ADDITION, attr, value: fx[k], label: fx.label || '穿透' })
        }
        events.push({ type: 'buff', side: unit.side, label: fx.label || '穿透提升' })
        break
      }
      case 'bonusFlux': {
        battle._bonusFlux += fx.amount
        events.push({ type: 'judgeProc', side: unit.side, label: `战后通量+${fx.amount}` })
        break
      }
      case 'rerollCharge': {
        unit.rerollCharges += fx.count || 1
        events.push({ type: 'buff', side: unit.side, label: `重抽充能+${fx.count || 1}` })
        break
      }
      case 'regrowth': {
        unit.hots.push({ amount: eff.atk * fx.pct, turns: fx.turns || 3 })
        events.push({ type: 'buff', side: unit.side, label: `再生：每回合回复${fmtShort(eff.atk * fx.pct)}（${fx.turns || 3}回合）` })
        break
      }
      case 'thorns': {
        unit.judges.push({
          priority: PRIORITY.REFLECT, label: fx.label || '荆棘', stopOnZero: false, uses: fx.uses,
          apply: () => ({ reflect: { amount: fx.amount }, event: { type: 'judgeProc', side: unit.side, label: `${fx.label || '荆棘'}：反弹${fx.amount}` } })
        })
        events.push({ type: 'buff', side: unit.side, label: `${fx.label || '荆棘'}×${fx.uses || 1}次` })
        break
      }
      case 'copyDie': {
        const others = unit.pool.filter((d) => d !== die)
        if (others.length > 0) {
          const src = rngPick(others)
          const copy = createDie({
            id: src.defId, pips: src.pips, kinds: src.kinds, onRoll: src.onRoll,
            tempTurns: src.remaining > 0 ? src.remaining : 0
          })
          const ok = addDie(unit, copy)
          events.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: unit.side, pips: copy.pips, name: copy.defId })
        }
        break
      }
      case 'selfDamage': {
        events.push(...runDamagePipeline(battle, unit, unit, {
          type: DamageType.TRUE, amount: eff.atk * fx.pct, cause: 'selfDamage', depth: 1
        }))
        break
      }
      case 'transpose': {
        const others = unit.pool.filter((d) => d !== die)
        if (others.length > 0) {
          const tgt = rngPick(others)
          const tmp = die.pips
          die.pips = tgt.pips
          tgt.pips = tmp
          events.push({ type: 'transpose', side: unit.side, pips: die.pips, from: tgt.pips })
        }
        break
      }
      case 'decay': {
        foe.dots.push({ amount: fx.amount, turns: fx.turns || 2 })
        events.push({ type: 'debuff', side: foe.side, label: `衰变：每回合${fx.amount}真伤（${fx.turns || 2}回合）` })
        break
      }
      case 'leavePool': {
        removeDie(unit, die)
        break
      }
    }
  }
  // 衰变协议：本次行动包含攻击时，为敌方附加衰变（每次行动至多一层）
  if (attacked && unit.flags.decayOnHit && foe.hp > 0) {
    foe.dots.push({ amount: unit.flags.decayOnHit, turns: 2 })
    events.push({ type: 'debuff', side: foe.side, label: `衰变：每回合${unit.flags.decayOnHit}真伤（2回合）` })
  }
  // 易碎骰子：被投出后失去（kinds 标记，双保险；骰子淬火可保留）
  if (die.kinds.includes('FRAGILE_SELF') && !unit.flags.fragileKeep) removeDie(unit, die)
  // 深渊回响：记录上回合骰子类型
  unit.lastDieKind = die.kinds.join(',')
  events.push({ type: 'action', side: unit.side, pips, die: die.defId })
  // 行动结算后钩子（连击信标/类型检查/尾链延续等）
  events.push(...battle.emit('actionResolved', { battle, unit, die }))
}

function fmtShort(n) {
  return Math.floor(n).toLocaleString()
}

// 死亡检查与复活（应急熔断）
function checkDeaths(battle, events) {
  if (battle.over) return true
  if (battle.enemy.hp <= 0) {
    battle.over = 'victory'
    events.push({ type: 'victory' })
    events.push(...battle.emit('battleEnd', { battle, winner: 'ally' }))
    return true
  }
  if (battle.ally.hp <= 0) {
    if (battle.ally.flags.reviveAvailable) {
      battle.ally.flags.reviveAvailable = false
      const eff = computeEffAttrs(battle.ally)
      const pct = battle.ally.flags.reviveHpPct ?? 0.3
      battle.ally.hp = Math.floor(eff.hp * pct)
      events.push({ type: 'revive', side: 'ally', hp: battle.ally.hp })
      if (battle.ally.flags.reviveShields > 0) {
        const ev = addShieldLayers(battle.ally, battle.ally.flags.reviveShields, '背水一战')
        if (ev) events.push(ev)
      }
      return false
    }
    battle.over = 'defeat'
    events.push({ type: 'defeat' })
    events.push(...battle.emit('battleEnd', { battle, winner: 'enemy' }))
    return true
  }
  return false
}
