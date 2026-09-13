// 连战开局：局末自动进入下一局
// 自动协议：从激活方案 config.opening 读取干员/武器
// 智慧协议：AI 决策开局（失败回落方案 opening）
import { createRun } from './run.js'
import { G, saveRun } from '../state.js'
import { getActiveScheme } from './schemes.js'
import { smartDecideOpening } from './aiService.js'

// 自动开局下一局。protocolId：上一局协议（agent/smart）
// 返回 { ok, operator, weapon, by }
export async function startChainRun(protocolId, lastReport = null) {
  const scheme = getActiveScheme()
  const fallback = scheme?.config?.opening || { operator: 'baseline', weapon: 'standard' }
  let opening = fallback
  let by = 'scheme'

  // 智慧协议：AI 决策开局
  if (protocolId === 'smart') {
    const res = await smartDecideOpening(lastReport || { note: '上一局情报缺失（首次连战或数据未记录）' })
    if (res.ok) {
      opening = res.opening
      by = 'ai'
    } else {
      by = 'fallback'
    }
  }

  // 创建对局并直接挂接协议（跳过选人界面）
  G.run = createRun(opening.operator, opening.weapon)
  G.run.settings.protocol = protocolId
  // 连战链路保持当前速度/动画偏好
  if (lastReport?.speed) G.run.settings.speed = lastReport.speed
  if (lastReport?.animSkip != null) G.run.settings.animSkip = lastReport.animSkip
  G.profile.totalRuns++
  await saveRun()
  return { ok: true, operator: opening.operator, weapon: opening.weapon, by }
}
