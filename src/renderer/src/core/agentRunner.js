// 协议决策调度：统一处理自动代理（本地优先级）与智慧代理（AI实时决策）在各决策点的执行
import { G } from '../state.js'
import {
  decideEventOption, decideRewardOption, decideBossLoot, decideShopActions
} from './agentConfig.js'
import { smartDecide } from './aiService.js'

// 协议是否接管某决策点
export function agentTakesOver(kind) {
  const p = G.run?.settings?.protocol
  if (p === 'agent' || p === 'smart') return true
  return false
}

export function isSmart() {
  return G.run?.settings?.protocol === 'smart'
}

// ── 战斗内重抽决策：返回选项索引或 null（保留） ──
// options: [{label}]；drawnPips: 当前抽出的点数；ctx: 局面摘要
export async function agentDecideReroll(options, drawnPips, ctx) {
  // 本地策略（自动代理 / 智慧代理AI失败回落）
  const local = () => {
    const rr = G.profile.agentConfig?.reroll || { lowPips: 3, manual: 'low' }
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]
      if (opt.label === '相位重掷') {
        if (rr.manual === 'always') return i
        if (rr.manual === 'low' && drawnPips <= rr.lowPips) return i
      } else if (opt.label === '频率偏移') {
        if (drawnPips <= rr.lowPips) return i
      } else if (opt.label === '量子重掷') {
        // 量子重掷不限点数：低点数时优先使用（充能有限）
        if (drawnPips <= rr.lowPips) return i
      } else {
        // 未知重抽选项：保守保留
      }
    }
    return null
  }
  if (isSmart()) {
    const res = await smartDecide(
      `战斗内重抽决策（当前抽出 ${drawnPips} 点，骰子点数1~6，越高越好）`,
      [{ label: '保留当前结果' }, ...options.map((o) => ({ label: o.label }))],
      ctx
    )
    if (res.ok) return res.choice === 0 ? null : res.choice - 1
    return local()
  }
  return local()
}

// 通用：带AI回落的决策执行
// localDecide(): 本地优先级决策（同步）→ 结果
// aiOptions/context: 智慧代理AI入参
// 返回 { choice } 或 { error }
async function decide(scene, aiOptions, context, localDecide) {
  if (isSmart()) {
    const res = await smartDecide(scene, aiOptions, context)
    if (res.ok) return { choice: res.choice, by: 'ai' }
    // AI失败：回落本地优先级
    return { choice: localDecide(), by: 'fallback', error: res.error }
  }
  return { choice: localDecide(), by: 'local' }
}

// ── 特殊事件 ──
export async function agentDecideEvent(eventId, options, run) {
  const ctx = {
    layer: run.layer, hp: Math.floor(run.hp), maxHp: maxHpOf(run),
    flux: run.flux, translators: run.translators.map((t) => t.id + (t.stacks > 1 ? `×${t.stacks}` : ''))
  }
  return decide(
    `特殊事件「${eventId}」选项选择`,
    options.map((o) => ({ label: o.label })),
    ctx,
    () => decideEventOption(G.profile.agentConfig, eventId, options, run)
  )
}

// ── 奖励关 ──
export async function agentDecideReward(run) {
  const ctx = {
    layer: run.layer, hp: Math.floor(run.hp), maxHp: maxHpOf(run), flux: run.flux,
    translators: run.translators.map((t) => t.id + (t.stacks > 1 ? `×${t.stacks}` : ''))
  }
  return decide(
    '奖励关三选一：0=随机普通转译器 1=80通量 2=恢复35%生命',
    [{ label: '随机普通转译器' }, { label: '80通量' }, { label: '恢复35%生命' }],
    ctx,
    () => decideRewardOption(G.profile.agentConfig, run)
  )
}

// ── BOSS高阶转译器 ──
export async function agentDecideBossLoot(bossId, poolIds, run) {
  const ctx = {
    layer: run.layer, hp: Math.floor(run.hp), maxHp: maxHpOf(run), flux: run.flux,
    held: run.translators.map((t) => t.id + (t.stacks > 1 ? `×${t.stacks}` : '')),
    coreSlots: run.coreSlots
  }
  const local = () => {
    const id = decideBossLoot(G.profile.agentConfig, bossId, poolIds)
    return poolIds.indexOf(id)
  }
  return decide(
    `BOSS战后高阶转译器三选一（BOSS：${bossId}）`,
    poolIds.map((id) => ({ label: id })),
    ctx,
    local
  )
}

// ── 商店购物序列（仅本地优先级；智慧代理同样按此执行后离开，逐件AI决策开销过高） ──
export function agentShopPlan(run, shelf) {
  return decideShopActions(G.profile.agentConfig, run, shelf)
}

// run 最大生命（避免循环依赖）
function maxHpOf(run) {
  const opHp = { baseline: 38000, offset: 32000, overflow: 30000, parity: 34000 }[run.operatorId] || 34000
  return Math.floor(opHp * (run.maxHpMult || 1))
}
