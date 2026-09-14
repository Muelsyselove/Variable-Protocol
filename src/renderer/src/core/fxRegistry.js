// 效果注册表与资源编译器（游戏核心算法的一部分）
// 职责：把资源 JSON 中的声明式效果（{"fx":"名","params":{...}}）编译为与旧版闭包同形状的运行时函数。
// 资源侧不携带任何算法：数值/文案在 JSON，行为在本模块。新增效果种类需要更新游戏核心。
//
// ctx 形态（按钩子类型）：
//   acquire  { run }
//   setup    { battle, unit, stacks, slotted, run? }   （转译器 onBattle / 敌人·干员·武器 setup）
//   event    { battle, unit, run, stacks, ev, _state } （battle.on 处理器内）
//   victory  { run, battle, stacks }
//
// 值表达式（val）：
//   数字 | { "base":1, "perStack":0.1,
//             "bonus": {"<转译器id>": 加算},            持有该转译器时 base 加算
//             "perStackBonus": {"<转译器id>": 加算} }   持有该转译器时 perStack 加算
// 连携覆写（with）：params.with = { "<转译器id>": {参数补丁} }，持有时整体合并补丁（用于整参数替换）
import { ModifierType, computeEffAttrs } from './attributes.js'
import { DamageType } from './damage.js'
import { addBarrier, addShieldLayers, runDamagePipeline, runHealPipeline, PRIORITY } from './judgment.js'
import { createDie, addDie, removeDie } from './dice.js'
import { rngPick, rngChance } from './rng.js'
import { ALL_DICE } from '../data/diceDefs.js'

// ── 基础工具 ──
const hasT = (run, id) => !!run?.translators?.some((t) => t.id === id)

function resolveParams(params, run) {
  const p = params || {}
  if (!p.with || !run) return p
  let patch = null
  for (const [id, sub] of Object.entries(p.with)) {
    if (hasT(run, id)) patch = { ...(patch || {}), ...sub }
  }
  return patch ? { ...p, ...patch } : p
}

function val(spec, ctx) {
  if (spec == null) return 0
  if (typeof spec === 'number') return spec
  const stacks = ctx?.stacks || 1
  let base = spec.base ?? 0
  let per = spec.perStack ?? 0
  if (spec.bonus) for (const [id, add] of Object.entries(spec.bonus)) if (hasT(ctx?.run, id)) base += add
  if (spec.perStackBonus) for (const [id, add] of Object.entries(spec.perStackBonus)) if (hasT(ctx?.run, id)) per += add
  return base + per * stacks
}

// ══════════ 条件编译器（when DSL）══════════

// dealMults 条件：cond(dmg, defender)
function compileDealWhen(w, ctx) {
  if (!w) return null
  const self = ctx.unit
  return (dmg, defender) => {
    if (w.dmgType != null && dmg.type !== DamageType[w.dmgType]) return false
    if (w.dieKinds && !dmg.die?.kinds?.includes(w.dieKinds)) return false
    if (w.diePipsLte != null && !(dmg.die?.pips != null && dmg.die.pips <= w.diePipsLte)) return false
    if (w.cause != null && dmg.cause !== w.cause) return false
    if (w.causeIn && !w.causeIn.includes(dmg.cause)) return false
    if (w.foeCrash && !defender?.crash) return false
    if (w.foeHpBelow != null && !(defender.hp > 0 && defender.hp < computeEffAttrs(defender).hp * w.foeHpBelow)) return false
    if (w.selfHpAbove != null && !(self.hp > computeEffAttrs(self).hp * w.selfHpAbove)) return false
    if (w.selfHpBelow != null && !(self.hp > 0 && self.hp < computeEffAttrs(self).hp * w.selfHpBelow)) return false
    if (w.turnGte != null && !(ctx.battle.turn >= w.turnGte)) return false
    return true
  }
}

// recvMults 条件：cond()
function compileRecvWhen(w, ctx) {
  if (!w) return null
  const self = ctx.unit
  return () => {
    if (w.turnLte != null && !(ctx.battle.turn <= w.turnLte)) return false
    if (w.selfHpBelow != null && !(self.hp > 0 && self.hp < computeEffAttrs(self).hp * w.selfHpBelow)) return false
    return true
  }
}

// healMults 条件：cond(t)（t=治疗目标）
function compileHealWhen(w) {
  if (!w) return null
  if (w.firstUse) {
    let used = false
    return () => { if (used) return false; used = true; return true }
  }
  return (t) => {
    if (w.targetHpBelow != null && !(t.hp < computeEffAttrs(t).hp * w.targetHpBelow)) return false
    if (w.targetHpBelowBase != null && !(t.hp < t.attrs.hp * w.targetHpBelowBase)) return false
    return true
  }
}

// actionMults 条件：cond(b, u, die, pips) → 数字倍率或 null
function compileActionWhen(w, mult) {
  if (!w) return () => mult
  if (w.firstUse) {
    let used = false
    return () => { if (used) return null; used = true; return mult }
  }
  return (b, u, die, pips) => {
    if (w.pipsEq != null) return pips === w.pipsEq ? mult : null
    if (w.pipsGte != null) return pips >= w.pipsGte ? mult : null
    if (w.consecGte != null) return u.consecKindCount >= w.consecGte ? mult : null
    if (w.lastDieSame) return u.lastDieKind != null && die.kinds.join(',') === u.lastDieKind ? mult : null
    if (w.lastDieDiff) return u.lastDieKind != null && die.kinds.join(',') !== u.lastDieKind ? mult : null
    if (w.orderSecond) return b._order?.[0] && b._order[0] !== u ? mult : null
    if (w.orderFirst) return b._order?.[0] === u ? (w.tieMult && b._tieWonThisTurn ? w.tieMult : mult) : null
    if (w.rerolled) return b._rerolledThisTurn ? mult : null
    if (w.rerollHighPips) return b._rerollHighPips ? mult : null
    if (w.dieKinds) return die.kinds.includes(w.dieKinds) ? mult : null
    return mult
  }
}

// 事件触发条件（battle.on 处理器内）：state 提供 once/maxUses 计数
function checkEventWhen(w, ctx, state) {
  if (!w) return true
  const { battle, unit: self, ev } = ctx
  if (w.selfAlive === true && !(self.hp > 0)) return false
  if (w.foeAlive === true && !(self.foe && self.foe.hp > 0)) return false
  if (w.foeCrash === true && !(self.foe && self.foe.hp > 0 && self.foe.crash)) return false
  if (w.eventUnitAlive === true && !(ev?.unit && ev.unit.hp > 0)) return false
  if (w.turnMod && battle.turn % w.turnMod[0] !== w.turnMod[1]) return false
  if (w.turnGte != null && !(battle.turn >= w.turnGte)) return false
  if (w.hasShield === true && !(self.shieldLayers > 0)) return false
  if (w.hasShield === false && !(self.shieldLayers <= 0)) return false
  if (w.poolBelow != null && !(self.pool.length < w.poolBelow)) return false
  if (w.selfHpBelow != null) {
    const spec = typeof w.selfHpBelow === 'number' ? { value: w.selfHpBelow } : w.selfHpBelow
    const th = resolveParams(spec, ctx.run).value
    if (!(self.hp > 0 && self.hp < computeEffAttrs(self).hp * th)) return false
  }
  if (w.once === true && state.used) return false
  if (w.maxUses != null && state.count >= w.maxUses) return false
  if (w.dmgType != null && ev?.dmg?.type !== DamageType[w.dmgType]) return false
  if (w.drawnPipsEq != null) {
    const die = battle._drawn.ally
    if (!(die && die.pips === w.drawnPipsEq)) return false
  }
  if (w.consecGte != null && !(self.consecKindCount >= w.consecGte)) return false
  if (w.dieKinds != null && !ev?.die?.kinds?.includes(w.dieKinds)) return false
  return true
}

// ══════════ 审判效果构造器（judges）══════════
const JUDGE_BUILDERS = {
  // 固定倍率减伤（可限次数）：防火墙 / 冗余校验
  dmgMult(p, ctx) {
    ctx.unit.judges.push({
      priority: PRIORITY.MODIFY, label: p.label, uses: p.uses,
      apply: () => ({ mult: p.mult, event: { type: 'judgeProc', side: ctx.unit.side, label: p.proc } })
    })
  },
  // 概率减伤：校验者·容错校验
  dmgMultChance(p, ctx) {
    ctx.unit.judges.push({
      priority: PRIORITY.MODIFY, label: p.label,
      apply: () => (rngChance(p.chance)
        ? { mult: p.mult, event: { type: 'judgeProc', side: ctx.unit.side, label: p.proc } }
        : null)
    })
  },
  // 概率闪避（可限低血）：相位装甲 / 背水一战
  dodge(p, ctx) {
    const self = ctx.unit
    ctx.unit.judges.push({
      priority: PRIORITY.DODGE, label: p.label,
      apply: () => {
        if (p.hpBelow != null && !(self.hp > 0 && self.hp < computeEffAttrs(self).hp * p.hpBelow)) return null
        if (rngChance(p.chance)) return { zero: true, event: { type: 'judgeProc', side: self.side, label: p.proc } }
        return null
      }
    })
  },
  // 固定反伤：荆棘协议
  reflect(p, ctx) {
    ctx.unit.judges.push({
      priority: PRIORITY.REFLECT, label: p.label, stopOnZero: false,
      apply: () => ({ reflect: { amount: p.amount }, event: { type: 'judgeProc', side: ctx.unit.side, label: p.label } })
    })
  },
  // 按抵挡值比例反伤：镜相反射
  reflectBlockedPct(p, ctx) {
    ctx.unit.judges.push({
      priority: PRIORITY.REFLECT, label: p.label, stopOnZero: false,
      apply: (_dmg, _amount, _defender, state) => (state.blockedAmount > 0
        ? {
          reflect: { amount: state.blockedAmount * p.pct },
          event: { type: 'judgeProc', side: ctx.unit.side, label: p.label }
        }
        : null)
    })
  },
  // 单次伤害封顶（最大生命比例）：伤害封顶
  dmgCap(p, ctx) {
    ctx.unit.judges.push({
      priority: PRIORITY.MODIFY, label: p.label,
      apply: (_dmg, amount, defender) => {
        const cap = computeEffAttrs(defender).hp * p.capPct
        if (amount > cap) return { mult: cap / amount, event: { type: 'judgeProc', side: ctx.unit.side, label: p.label } }
        return null
      }
    })
  },
  // 每回合首次伤害封顶：模糊守卫
  perTurnDmgCap(p, ctx) {
    const battle = ctx.battle
    let turn = 0, used = false
    ctx.unit.judges.push({
      priority: PRIORITY.MODIFY, label: p.label,
      apply: (_dmg, amount) => {
        if (battle.turn !== turn) { turn = battle.turn; used = false }
        if (used || amount <= p.cap) return null
        used = true
        return { mult: p.cap / amount, event: { type: 'judgeProc', side: ctx.unit.side, label: p.proc } }
      }
    })
  },
  // 每回合首次概率闪避：空值守卫
  perTurnDodge(p, ctx) {
    const battle = ctx.battle
    let turn = 0, used = false
    ctx.unit.judges.push({
      priority: PRIORITY.DODGE, label: p.label,
      apply: () => {
        if (battle.turn !== turn) { turn = battle.turn; used = false }
        if (used) return null
        used = true
        if (rngChance(p.chance)) return { zero: true, event: { type: 'judgeProc', side: ctx.unit.side, label: p.proc } }
        return null
      }
    })
  },
  // 致命伤害归零并以1点生命存活：金丝雀部署
  canary(p, ctx) {
    let used = false
    ctx.unit.judges.push({
      priority: PRIORITY.MODIFY, label: p.label,
      apply: (_dmg, amount, defender) => {
        if (used || defender.hp <= 0 || amount < defender.hp) return null
        used = true
        defender.hp = 1
        return { mult: 0, event: { type: 'judgeProc', side: ctx.unit.side, label: p.proc } }
      }
    })
  }
}

// ══════════ 动态提供器构造器（dynamicProviders）══════════
const MULT = (attr, value, label) => ({ type: ModifierType.MULTIPLIER, attr, value, label })
const DYN_BUILDERS = {
  // 屏障存在期间攻击加成：蓄能壁垒
  atkIfBarrier(p) {
    return (u) => (u.barrier > 0 ? [MULT('atk', p.value, p.label)] : [])
  },
  // 骰池超出基准颗数加成：骰池架构
  atkPoolOver(p) {
    return (u) => {
      const extra = Math.max(0, u.pool.length - p.base)
      return extra > 0 ? [MULT('atk', p.per * extra, p.label)] : []
    }
  },
  // 去重骰子类型数加成：骰子策展
  atkDistinctKinds(p) {
    return (u) => {
      const kinds = new Set(u.pool.map((d) => d.kinds.join(',')))
      return kinds.size > 0 ? [MULT('atk', p.per * kinds.size, p.label)] : []
    }
  },
  // 高点骰计数加成：熵减引擎（核心）
  atkPipsGteCount(p) {
    return (u) => {
      const n = u.pool.filter((d) => d.pips >= p.pips).length
      return n > 0 ? [MULT('atk', p.per * n, p.label)] : []
    }
  },
  // 指定类型骰计数加成：缓存一致性（核心）
  atkKindsCount(p) {
    return (u) => {
      const n = u.pool.filter((d) => d.kinds.includes(p.kind)).length
      return n > 0 ? [MULT('atk', p.per * n, p.label)] : []
    }
  },
  // 超阈值骰计数加成（阈值连携可变）：栈溢出
  atkPoolOverThreshold(p) {
    return (u) => {
      const extra = Math.max(0, u.pool.length - p.threshold)
      return extra > 0 ? [MULT('atk', p.per * extra, p.label)] : []
    }
  },
  // 低血攻击加成（useBaseAttrs 以不含动态提供器的基准计算，避免递归）：干员·稳态偏置
  atkHpBelow(p) {
    return (u) => {
      const maxHp = p.useBaseAttrs ? computeEffAttrs(u, true).hp : computeEffAttrs(u).hp
      return u.hp < maxHp * p.below ? [MULT('atk', p.value, p.label)] : []
    }
  }
}

// ══════════ setup 期 fx（onBattle / 敌人·干员·武器 setup）══════════
const SETUP_FX = {
  // 静态修饰器
  mod(p, ctx) {
    ctx.unit.mods.push({
      type: p.mtype === 'add' ? ModifierType.ADDITION : ModifierType.MULTIPLIER,
      attr: p.attr, value: val(p.value, ctx), label: p.label
    })
  },
  // 造成伤害倍率
  dealMult(p, ctx) {
    const entry = { value: val(p.value, ctx), label: p.label }
    const cond = compileDealWhen(p.when, ctx)
    if (cond) entry.cond = cond
    ctx.unit.dealMults.push(entry)
  },
  // 治疗倍率
  healMult(p, ctx) {
    const entry = { value: val(p.value, ctx), label: p.label }
    const cond = compileHealWhen(p.when)
    if (cond) entry.cond = cond
    ctx.unit.healMults.push(entry)
  },
  // 受伤倍率
  recvMult(p, ctx) {
    const entry = { value: val(p.value, ctx), label: p.label }
    const cond = compileRecvWhen(p.when, ctx)
    if (cond) entry.cond = cond
    ctx.unit.recvMults.push(entry)
  },
  // 行动效果倍率（返回数字倍率或 null）
  actionMult(p, ctx) {
    const mult = val(p.mult, ctx)
    ctx.unit.actionMults.push({ label: p.label, cond: compileActionWhen(p.when, mult) })
  },
  // 心理损伤加成
  psychicBonus(p, ctx) { ctx.unit.psychicBonus += val(p.value, ctx) },
  // 旗标设置 / 累加
  flag(p, ctx) { ctx.unit.flags[p.name] = p.value ?? true },
  flagAdd(p, ctx) { ctx.unit.flags[p.name] = (ctx.unit.flags[p.name] || 0) + val(p.value, ctx) },
  // 屏障获取倍率
  barrierMult(p, ctx) { ctx.unit.barrierMult = (ctx.unit.barrierMult || 1) * p.mult },
  // 审判效果
  judge(p, ctx) { JUDGE_BUILDERS[p.kind]?.(p, ctx) },
  // 动态提供器
  dyn(p, ctx) { ctx.unit.dynamicProviders.push(DYN_BUILDERS[p.kind](p, ctx)) },
  // 战斗事件注册：event + 归属过滤（self/foe）+ 触发条件（when）+ 效果列表（do）
  on(p, ctx) {
    const self = ctx.unit
    const state = { used: false, count: 0 }
    ctx.battle.on(p.event, (ev) => {
      if (p.on === 'self' && ev?.unit != null && ev.unit !== self) return null
      if (p.on === 'foe' && ev?.unit != null && ev.unit === self) return null
      const ectx = { ...ctx, ev, _state: state }
      if (!checkEventWhen(p.when, ectx, state)) return null
      if (p.when?.once) state.used = true
      if (p.when?.maxUses != null) state.count++
      const out = runEventFx(p.do, ectx)
      return out.length ? out : null
    })
  },
  // 复活标记（应急熔断）：含 battleEnd 记账
  reviveOnce(p, ctx) {
    const { run, battle, unit } = ctx
    if (run && !run.reviveUsed) {
      unit.flags.reviveAvailable = true
      const up = resolveParams({ with: p.with }, run)
      if (up.hpPct != null) unit.flags.reviveHpPct = up.hpPct
      if (up.shields) unit.flags.reviveShields = up.shields
      battle.on('battleEnd', () => {
        if (!unit.flags.reviveAvailable) run.reviveUsed = true
        return null
      })
    }
  },
  // 连续同类骰递增增伤（递归体 BOSS）
  consecAttackRamp(p, ctx) {
    let consec = 0
    ctx.unit.actionMults.push({
      label: p.label,
      cond: (_b, _u, die) => {
        if (die.kinds.includes(p.kind || 'ATTACK')) consec = Math.min(consec + 1, p.capSteps + 1)
        else consec = 0
        return consec >= 2 ? 1 + p.step * Math.min(consec - 1, p.capSteps) : null
      }
    })
  }
}

// ══════════ event 期 fx（battle.on 处理器内执行）══════════
function eventTarget(ctx, spec) {
  if (spec === 'self') return ctx.unit
  if (spec === 'eventUnit') return ctx.ev?.unit ?? ctx.unit.foe
  return ctx.unit.foe
}

const EVENT_FX = {
  // 屏障：amount 固定 | atkMult 攻击力倍率 | hpPct 最大生命比例
  barrier(p, ctx) {
    const u = ctx.unit
    let amount
    if (p.amount != null) amount = val(p.amount, ctx)
    else if (p.atkMult != null) amount = computeEffAttrs(u).atk * p.atkMult
    else if (p.hpPct != null) amount = computeEffAttrs(u).hp * p.hpPct
    return addBarrier(u, amount, p.label)
  },
  // 护盾层
  shield(p, ctx) { return addShieldLayers(ctx.unit, val(p.layers, ctx), p.label) },
  // 治疗：hpPct | atkPct | amount
  heal(p, ctx) {
    const u = ctx.unit
    let amount
    if (p.hpPct != null) amount = computeEffAttrs(u).hp * p.hpPct
    else if (p.atkPct != null) amount = computeEffAttrs(u).atk * p.atkPct
    else amount = p.amount
    return runHealPipeline(ctx.battle, u, amount)
  },
  // 伤害：dtype | amount | atkMult | foeMaxHpPct | foePoolPer；target: foe(默认)/self/eventUnit
  damage(p, ctx) {
    const attacker = ctx.unit
    const target = eventTarget(ctx, p.target)
    let amount
    if (p.amount != null) amount = val(p.amount, ctx)
    else if (p.atkMult != null) amount = computeEffAttrs(attacker).atk * p.atkMult
    else if (p.foeMaxHpPct != null) amount = computeEffAttrs(target).hp * p.foeMaxHpPct
    else if (p.foePoolPer != null) amount = target.pool.length * p.foePoolPer
    if (p.crashTurnsPlus && target.crash) target.crash.turns += p.crashTurnsPlus
    return runDamagePipeline(ctx.battle, attacker, target, {
      type: DamageType[p.dtype || 'TRUE'], amount, cause: p.cause
    })
  },
  // 加入骰子：byId 引用骰子定义 | spec 显式规格；count 支持层叠值表达式；silent 不产生事件
  addDie(p, ctx) {
    const evs = []
    const n = Math.max(1, Math.round(val(p.count ?? 1, ctx)))
    for (let i = 0; i < n; i++) {
      let die
      if (p.byId) die = createDie({ ...ALL_DICE[p.byId] })
      else die = createDie({
        id: p.spec.id, pips: p.spec.pips, kinds: p.spec.kinds,
        onRoll: p.spec.onRoll, tempTurns: p.spec.tempTurns
      })
      const ok = addDie(ctx.unit, die)
      if (!p.silent) evs.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: ctx.unit.side, pips: die.pips, name: die.defId })
    }
    return evs
  },
  // 摧毁敌方骰子：which lowest/random；count；chance（池空时不消耗随机数）；alwaysInfo 池空也报事件
  removeFoeDice(p, ctx) {
    const foe = ctx.unit.foe
    if (!foe || foe.pool.length === 0) {
      return p.alwaysInfo ? { type: 'info', text: String(p.text).replace('{n}', 0) } : null
    }
    if (p.chance != null && !rngChance(p.chance)) return null
    let removed = 0
    if (p.which === 'lowest') {
      const sorted = [...foe.pool].sort((a, b) => a.pips - b.pips)
      for (const d of sorted.slice(0, val(p.count ?? 1, ctx))) { removeDie(foe, d); removed++ }
    } else {
      const n = Math.min(val(p.count ?? 1, ctx), foe.pool.length)
      for (let i = 0; i < n; i++) { removeDie(foe, rngPick(foe.pool)); removed++ }
    }
    return { type: 'info', text: String(p.text).replace('{n}', removed) }
  },
  // 复制我方点数最高骰子：镜像池
  copyBestDie(p, ctx) {
    const evs = []
    for (let i = 0; i < (p.count ?? 1); i++) {
      if (ctx.unit.pool.length === 0) break
      const src = [...ctx.unit.pool].sort((a, b) => b.pips - a.pips)[0]
      const copy = createDie({
        id: src.defId, pips: src.pips, kinds: src.kinds, onRoll: src.onRoll,
        tempTurns: src.remaining > 0 ? src.remaining : 0
      })
      const ok = addDie(ctx.unit, copy)
      evs.push({ type: ok ? 'dieAdded' : 'dieAddFail', side: ctx.unit.side, pips: copy.pips, name: copy.defId })
    }
    return evs
  },
  // 双方随机骰点数调整：解引用
  derefPips(p, ctx) {
    const evs = []
    const foe = ctx.unit.foe
    if (foe.pool.length > 0) {
      const d = rngPick(foe.pool)
      d.pips = Math.max(p.min ?? 1, d.pips + (p.foeDelta ?? 0))
      evs.push({ type: 'info', text: `${p.label}：敌方1颗骰子降至${d.pips}点` })
    }
    if (ctx.unit.pool.length > 0) {
      const d = rngPick(ctx.unit.pool)
      d.pips = d.pips + (p.allyDelta ?? 0)
      evs.push({ type: 'info', text: `${p.label}：我方1颗骰子升至${d.pips}点` })
    }
    return evs
  },
  // 移除自身负向乘算修饰器
  cleanse(p, ctx) {
    const before = ctx.unit.mods.length
    ctx.unit.mods = ctx.unit.mods.filter((m) => !(m.type === ModifierType.MULTIPLIER && m.value < 0))
    return { type: 'cleanse', side: ctx.unit.side, removed: before - ctx.unit.mods.length }
  },
  // 提示/裁定事件
  info(p) { return { type: 'info', text: p.text } },
  proc(p, ctx) { return { type: 'judgeProc', side: ctx.unit.side, label: p.label } },
  // 重抽充能（≤3点）与不限点数重抽
  rerollCharges(p, ctx) {
    const n = val(p.count, ctx)
    ctx.unit.rerollCharges += n
    return { type: 'info', text: String(p.text).replace('{n}', n) }
  },
  rerollAny(p, ctx) {
    const n = val(p.count, ctx)
    ctx.unit.flags.rerollAnyCharges += n
    return { type: 'info', text: String(p.text).replace('{n}', n) }
  },
  // 攻击力乘算修饰 + buff 事件（开战快照/回合成长等）
  atkMod(p, ctx) {
    ctx.unit.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: val(p.value, ctx), label: p.label })
    return { type: 'buff', side: ctx.unit.side, label: p.buffText || p.label }
  },
  // 开战通量快照加成：通量透镜
  fluxSnapshot(p, ctx) {
    const bonus = Math.min(p.cap, Math.floor(ctx.run.flux / p.perFlux) * p.step)
    if (bonus > 0) {
      ctx.unit.mods.push({ type: ModifierType.MULTIPLIER, attr: 'atk', value: bonus, label: p.label })
      return { type: 'buff', side: ctx.unit.side, label: `${p.label}：攻击力+${Math.round(bonus * 100)}%` }
    }
    return null
  },
  // 受物理伤害后叠加防御（限次数）：自适应装甲
  adaptiveDef(p, ctx) {
    const st = ctx._state
    st.count = (st.count || 0) + 1
    ctx.unit.mods.push({ type: ModifierType.ADDITION, attr: 'def', value: p.amount, label: p.label })
    return { type: 'buff', side: ctx.unit.side, label: `${p.label}：防御+${p.amount}（${st.count}/${p.max}）` }
  },
  // 概率追击法术伤害：类型检查
  followUp(p, ctx) {
    if (!rngChance(p.chance)) return null
    const eff = computeEffAttrs(ctx.unit)
    return runDamagePipeline(ctx.battle, ctx.unit, ctx.unit.foe, {
      type: DamageType[p.dtype], amount: eff.atk * p.atkMult, cause: p.cause
    })
  }
}

function runEventFx(list, ctx) {
  const out = []
  for (const e of list || []) {
    const params = resolveParams(e.params, ctx.run)
    const r = EVENT_FX[e.fx]?.(params, ctx)
    if (r) out.push(...(Array.isArray(r) ? r : [r]))
  }
  return out
}

// ══════════ victory 期 fx（战斗胜利结算）══════════
const VICTORY_FX = {
  // 通量：perStack | pctOfFlux+cap | perTranslator
  flux(p, ctx) {
    if (p.perTranslator != null) return { flux: p.perTranslator * ctx.run.translators.length * (ctx.stacks || 1) }
    if (p.pctOfFlux != null) {
      const cap = resolveParams({ cap: p.cap, with: p.with }, ctx.run).cap
      return { flux: Math.min(Math.floor(ctx.run.flux * p.pctOfFlux), cap) }
    }
    return { flux: val(p, ctx) }
  },
  // 战后恢复比例：ifHas 条件（凝血装甲连携）
  healPct(p, ctx) {
    if (p.ifHas && !hasT(ctx.run, p.ifHas)) return null
    return { healPct: val(p.value != null ? p.value : p, ctx) }
  },
  // 局内永久攻击力：快速迭代
  permAtk(p, ctx) { return { permAtk: val(p, ctx) } }
}

// ══════════ acquire 期 fx（获得转译器时）══════════
const ACQUIRE_FX = {
  // 本局永久额外骰子：频谱探针
  extraDice(p, ctx) { ctx.run.extraDice.push(p.id) },
  // 骰池上限：虚拟内存
  poolCap(p, ctx) { ctx.run.poolCapBonus = (ctx.run.poolCapBonus || 0) + p.add },
  // 最大生命乘算：生命模组/内存对齐
  modMaxHp(p, ctx) { ctx.run.modMaxHp(p.mult) }
}

// ══════════ 编译器 ══════════
// fx 条目通用守卫：ifSlotted（核心入槽）/ ifHas / unlessHas（连携持有判定）
function entryAllowed(e, params, ctx) {
  if (e.ifSlotted && !ctx.slotted) return false
  if (params.ifHas && !hasT(ctx.run, params.ifHas)) return false
  if (params.unlessHas && hasT(ctx.run, params.unlessHas)) return false
  return true
}

function runSetupFx(list, ctx) {
  for (const e of list || []) {
    const params = resolveParams(e.params, ctx.run)
    if (!entryAllowed(e, params, ctx)) continue
    SETUP_FX[e.fx]?.(params, ctx)
  }
}

// 转译器：产出与旧版同形状的 {id,name,tier,stackable,price,boss,desc,onAcquire?,onBattle?,onVictory?,synergy?}
export function compileTranslator(def) {
  const out = { id: def.id, name: def.name, tier: def.tier, stackable: !!def.stackable }
  if (def.price != null) out.price = def.price
  if (def.boss) out.boss = def.boss
  out.desc = def.desc
  if (def.onAcquire?.length) {
    out.onAcquire = (run) => {
      for (const e of def.onAcquire) {
        const params = resolveParams(e.params, run)
        if (!entryAllowed(e, params, { run })) continue
        ACQUIRE_FX[e.fx]?.(params, { run })
      }
    }
  }
  if (def.onBattle?.length) {
    // 引擎以 {battle, ally, stacks, slotted, run} 调用（ally 即效果归属单位）
    out.onBattle = (ctx) => runSetupFx(def.onBattle, { stacks: 1, ...ctx, unit: ctx.ally })
  }
  if (def.onVictory?.length) {
    out.onVictory = (ctx) => {
      let flux = 0, healPct = 0, permAtk = 0, any = false
      for (const e of def.onVictory) {
        const params = resolveParams(e.params, ctx.run)
        if (!entryAllowed(e, params, ctx)) continue
        const r = VICTORY_FX[e.fx]?.(params, { stacks: 1, ...ctx })
        if (!r) continue
        any = true
        if (r.flux) flux += r.flux
        if (r.healPct) healPct += r.healPct
        if (r.permAtk) permAtk += r.permAtk
      }
      return any ? { flux, healPct, permAtk } : null
    }
  }
  if (def.synergy) {
    out.synergy = { requires: def.synergy.requires, desc: def.synergy.desc }
    if (def.synergy.onBattle?.length) {
      out.synergy.onBattle = (ctx) => runSetupFx(def.synergy.onBattle, { stacks: 1, ...ctx, unit: ctx.ally })
    }
  }
  return out
}

// 敌人：setup(unit, battle)
export function compileEnemy(def) {
  const out = { ...def }
  delete out.setupFx
  if (def.setupFx?.length) {
    out.setup = (unit, battle) => runSetupFx(def.setupFx, { battle, unit, stacks: 1 })
  } else {
    out.setup = undefined
  }
  return out
}

// 干员：setup / ability（ability 为旧版遗留字段，从未被引擎调用——统一编译进 setup）
export function compileOperator(def) {
  const out = { ...def }
  delete out.setupFx
  delete out.abilityFx
  const list = [...(def.setupFx || []), ...(def.abilityFx || [])]
  if (list.length) {
    out.setup = (unit, battle) => runSetupFx(list, { battle, unit, stacks: 1 })
  } else {
    out.setup = undefined
  }
  return out
}

// 武器：effect = { setup } | null
export function compileWeapon(def) {
  const out = { ...def }
  delete out.setupFx
  if (def.setupFx?.length) {
    out.effect = { setup: (unit, battle) => runSetupFx(def.setupFx, { battle, unit, stacks: 1 }) }
  } else {
    out.effect = null
  }
  return out
}

// fx 名称集合（供资源 lint 校验引用完整性）
export const FX_NAMES = {
  acquire: Object.keys(ACQUIRE_FX),
  setup: Object.keys(SETUP_FX),
  event: Object.keys(EVENT_FX),
  victory: Object.keys(VICTORY_FX),
  judge: Object.keys(JUDGE_BUILDERS),
  dyn: Object.keys(DYN_BUILDERS)
}
