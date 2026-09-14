// 自动代理优先级配置：事件选项/商店购买/奖励关/BOSS掉落/核心放置/开局选择
// 配置存于 profile.json（跨局共享，现以"方案池"形式管理，见 core/schemes.js），AI可生成覆盖，玩家可重置默认
import { EVENTS, addTranslator } from '../data/events.js'
import { TRANSLATORS } from '../data/translators.js'
import { OPERATORS } from '../data/operators.js'
import { WEAPONS } from '../data/weapons.js'

// 资源外部化后数据为异步加载填充：id 集合改为惰性读取（调用时点数据已就绪）
const opIds = () => new Set(OPERATORS.map((o) => o.id))
const wpnIds = () => new Set(WEAPONS.map((w) => w.id))

// ── 默认优先级（均衡策略） ──
export function defaultAgentConfig() {
  return {
    opening: { operator: 'baseline', weapon: 'standard' },  // 开局选择：干员+武器
    eventPriority: {
      randomNumber: { prefer: [0, 1], minFlux: 60 },        // 通量充足时赌一把，否则离开
      dataDebris: { prefer: [2, 1, 0] },                     // 模块 > 通量 > 治疗
      overclock: { prefer: [0] },                             // 接受献祭
      resonance: { prefer: [0] },                             // 强化转译器
      entropyAbyss: { prefer: [0], minHpPct: 0.5 },          // 生命过半时换通量
      parallelSample: { prefer: [0] },                        // 标记下一场
      voidWhisper: { prefer: [0] },                           // 接受强袭骰
      redundantBackup: { prefer: [0] }                        // 读取备份
    },
    shop: {
      healBelowPct: 0.5,                                      // 生命低于50%时优先恢复
      buyPriorities: [                                        // 想买的普通转译器（顺序即优先级）
        'hotSpare', 'signalAmp', 'etchMold', 'fastIter',
        'psyLens', 'freqShift', 'mirrorReflect', 'fluxSiphon',
        'greedySample', 'fuseBreaker', 'spectrumProbe'
      ],
      keepFlux: 60,                                           // 购物保留的通量下限
      buyPoolExpand: true,                                    // 骰池扩容
      buyDicePack: true                                       // 临时骰礼包
    },
    rewardPriority: { prefer: [0, 1, 2], healBelowPct: 0.4 }, // 转译器 > 通量 > 治疗；低生命时优先治疗
    bossLoot: {
      verifier: ['assertModule', 'redundantCheck', 'exceptionCatch'],
      recursion: ['tailCall', 'memLeak', 'stackOverflow'],
      nullref: ['nullMerge', 'lazyEval', 'shortCircuit']
    },
    corePriority: ['covarianceCore', 'entropyEngine', 'boundPointer'], // 核心转译器放置优先级（高在前）
    reroll: {                                                  // 战斗内重抽决策
      lowPips: 3,           // 抽出≤此点数即重抽（用频率偏移等充能重抽）
      manual: 'low'         // 相位重掷使用时机：'always'=每次都重掷 | 'low'=仅低点数 | 'never'=不使用
    }
  }
}

// ── 配置校验与合并：AI生成/存档读取的配置逐字段校验，非法项回落默认 ──
export function sanitizeAgentConfig(raw) {
  const def = defaultAgentConfig()
  if (!raw || typeof raw !== 'object') return def
  const out = def
  try {
    // 开局选择：干员/武器id校验
    const op = raw.opening?.operator
    const wpn = raw.opening?.weapon
    const OP_IDS = opIds()
    const WPN_IDS = wpnIds()
    if (OP_IDS.has(op) || WPN_IDS.has(wpn)) {
      out.opening = {
        operator: OP_IDS.has(op) ? op : def.opening.operator,
        weapon: WPN_IDS.has(wp) ? wp : def.opening.weapon
      }
    }
    // 事件优先级：仅接受已知事件id与合法选项索引
    const validEventIds = new Set(EVENTS.map((e) => e.id))
    for (const [eid, rule] of Object.entries(raw.eventPriority || {})) {
      if (!validEventIds.has(eid) || !rule || !Array.isArray(rule.prefer)) continue
      const ev = EVENTS.find((e) => e.id === eid)
      const prefer = rule.prefer.filter((i) => Number.isInteger(i) && i >= 0 && i < ev.options.length)
      const merged = { prefer: prefer.length ? prefer : def.eventPriority[eid]?.prefer || [0] }
      if (Number.isFinite(rule.minFlux) && rule.minFlux >= 0) merged.minFlux = rule.minFlux
      if (Number.isFinite(rule.minHpPct) && rule.minHpPct > 0 && rule.minHpPct <= 1) merged.minHpPct = rule.minHpPct
      out.eventPriority[eid] = merged
    }
    // 商店
    const s = raw.shop || {}
    if (Number.isFinite(s.healBelowPct) && s.healBelowPct > 0 && s.healBelowPct <= 1) out.shop.healBelowPct = s.healBelowPct
    if (Array.isArray(s.buyPriorities)) {
      const valid = s.buyPriorities.filter((id) => id && TRANSLATORS[id]?.tier === 'normal')
      out.shop.buyPriorities = valid.length ? valid : def.shop.buyPriorities
    }
    if (Number.isFinite(s.keepFlux) && s.keepFlux >= 0) out.shop.keepFlux = s.keepFlux
    if (typeof s.buyPoolExpand === 'boolean') out.shop.buyPoolExpand = s.buyPoolExpand
    if (typeof s.buyDicePack === 'boolean') out.shop.buyDicePack = s.buyDicePack
    // 奖励关
    const r = raw.rewardPriority || {}
    if (Array.isArray(r.prefer)) {
      const prefer = r.prefer.filter((i) => Number.isInteger(i) && i >= 0 && i < 3)
      out.rewardPriority.prefer = prefer.length ? prefer : def.rewardPriority.prefer
    }
    if (Number.isFinite(r.healBelowPct) && r.healBelowPct > 0 && r.healBelowPct <= 1) out.rewardPriority.healBelowPct = r.healBelowPct
    // BOSS掉落
    for (const boss of ['verifier', 'recursion', 'nullref']) {
      const list = raw.bossLoot?.[boss]
      if (Array.isArray(list)) {
        const valid = list.filter((id) => id && TRANSLATORS[id]?.boss === boss)
        if (valid.length) out.bossLoot[boss] = valid
      }
    }
    // 核心放置
    if (Array.isArray(raw.corePriority)) {
      const valid = raw.corePriority.filter((id) => id && TRANSLATORS[id]?.tier === 'core')
      if (valid.length) out.corePriority = valid
    }
    // 重抽决策
    const rr = raw.reroll || {}
    if (Number.isFinite(rr.lowPips) && rr.lowPips >= 1 && rr.lowPips <= 6) out.reroll.lowPips = Math.floor(rr.lowPips)
    if (['always', 'low', 'never'].includes(rr.manual)) out.reroll.manual = rr.manual
  } catch { /* 保持默认 */ }
  return out
}

// ── 决策函数（自动代理，本地同步执行） ──

// 特殊事件：返回选项索引。跳过条件不满足（通量不足/生命不足）的选项
export function decideEventOption(config, eventId, options, run) {
  const rule = config.eventPriority[eventId] || { prefer: [0] }
  const maxHp = runMaxHpOf(run)
  for (const idx of rule.prefer) {
    const opt = options[idx]
    if (!opt) continue
    if (opt.cost && run.flux < opt.cost) continue
    if (rule.minFlux != null && (opt.cost || 0) > 0 && run.flux < rule.minFlux) continue
    if (rule.minHpPct != null && run.hp < maxHp * rule.minHpPct) continue
    return idx
  }
  // 全部不满足：选最后一个无条件选项（通常是"离开/拒绝"），否则选末项
  for (let i = options.length - 1; i >= 0; i--) {
    const opt = options[i]
    if (!opt.cost) return i
  }
  return options.length - 1
}

// 奖励关：0转译器 1通量 2治疗
export function decideRewardOption(config, run) {
  const rule = config.rewardPriority
  const maxHp = runMaxHpOf(run)
  if (run.hp < maxHp * rule.healBelowPct) return 2
  for (const idx of rule.prefer) {
    if (idx === 0 && run.translators.length >= 14) continue // 转译器近乎集齐时转其他奖励
    return idx
  }
  return 1
}

// BOSS高阶转译器三选一：按优先序选第一个出现的
export function decideBossLoot(config, bossId, poolIds) {
  const order = config.bossLoot[bossId] || []
  for (const id of order) {
    if (poolIds.includes(id)) return id
  }
  return poolIds[0]
}

// 商店购物序列：返回动作列表 [{type:'buy', idx}, ..., {type:'leave'}]
// shelf: [{kind, id?, ref?, name, price, sold?}]
export function decideShopActions(config, run, shelf) {
  const actions = []
  const maxHp = runMaxHpOf(run)
  const budget = () => run.flux - config.shop.keepFlux
  const affordable = (p) => run.flux - p >= config.shop.keepFlux

  // 1. 恢复优先：生命不足时买恢复类商品（买得起深层修复则优先）
  if (run.hp < maxHp * config.shop.healBelowPct) {
    const heals = shelf.map((it, i) => ({ it, i }))
      .filter(({ it }) => !it.sold && it.kind === 'special' && ['injection', 'deepRepair'].includes(it.ref?.id))
      .sort((a, b) => b.it.price - a.it.price)
    for (const { i } of heals) {
      if (affordable(shelf[i].price)) { actions.push({ type: 'buy', idx: i }); break }
    }
  }
  // 2. 骰池扩容 / 临时骰礼包
  if (config.shop.buyPoolExpand || config.shop.buyDicePack) {
    shelf.forEach((it, i) => {
      if (it.sold || it.kind !== 'special') return
      const id = it.ref?.id
      if (id === 'poolExpand' && config.shop.buyPoolExpand && (run['bought_poolExpand'] || 0) < 2 && affordable(it.price)) {
        actions.push({ type: 'buy', idx: i })
      } else if (id === 'dicePack' && config.shop.buyDicePack && affordable(it.price)) {
        actions.push({ type: 'buy', idx: i })
      }
    })
  }
  // 2.5 核心货柜：预算充足时购买核心转译器
  shelf.forEach((it, i) => {
    if (!it.sold && it.kind === 'core' && affordable(it.price)) {
      actions.push({ type: 'buy', idx: i })
    }
  })
  // 3. 按优先级购买转译器（不重复购买不可叠加的）
  for (const tid of config.shop.buyPriorities) {
    const owned = run.translators.find((t) => t.id === tid)
    if (owned && !TRANSLATORS[tid]?.stackable) continue
    const idx = shelf.findIndex((it) => !it.sold && it.kind === 'translator' && it.id === tid)
    if (idx >= 0 && affordable(shelf[idx].price)) actions.push({ type: 'buy', idx })
  }
  actions.push({ type: 'leave' })
  void budget
  return actions
}

// 核心转译器放置：agent 激活时获得核心转译器的入槽决策
// 返回目标槽位索引；null = 不放置
export function decideCoreSlot(config, run, coreId) {
  const order = config.corePriority
  const prio = (id) => {
    const i = order.indexOf(id)
    return i >= 0 ? i : order.length + 1 // 未列入的排最后
  }
  // 空槽：选优先级最高的空槽位（保留前面的槽给更优先核心）
  const empty = run.coreSlots.indexOf(null)
  if (empty >= 0) {
    // 若新核心优先级低于某个空槽预期保留……简化：直接装入空槽
    return empty
  }
  // 槽满：替换优先级最低且低于新核心的
  let worst = -1, worstPrio = -1
  run.coreSlots.forEach((id, i) => {
    if (!id) return
    const p = prio(id)
    if (p > worstPrio) { worstPrio = p; worst = i }
  })
  if (worst >= 0 && prio(coreId) < worstPrio) return worst
  return null
}

// agent 激活时获得核心转译器：按优先级放置/替换（替代默认"装第一个空槽"）
export function placeCoreWithPriority(config, run, coreId) {
  const slot = decideCoreSlot(config, run, coreId)
  if (slot == null) return false
  run.coreSlots[slot] = coreId
  return true
}

// run 最大生命（本地复用，避免循环依赖 run.js）
function runMaxHpOf(run) {
  const opHp = { baseline: 38000, offset: 32000, overflow: 30000, parity: 34000 }[run.operatorId] || 34000
  return Math.floor(opHp * (run.maxHpMult || 1))
}

export { addTranslator }
