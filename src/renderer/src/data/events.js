// 特殊事件与奖励关注册表（数据来自外部资源包 resources/game/data/events.json）
// 选项结果：script 引用核心具名脚本（core/eventScripts.js），outcomes 为声明式结果 fx
// addTranslator/grantRandomTranslator 为核心逻辑（转译器入池/核心入槽），保留在核心侧
import { rngPick } from '../core/rng.js'
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

// 由 core/gameData.js 加载编译填充；保持导出引用不变（原地填充）
export const EVENTS = []
export const REWARD_OPTIONS = []

export function randomEvent() {
  return rngPick(EVENTS)
}
