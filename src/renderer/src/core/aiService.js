// AI 服务：OpenAI 兼容接口调用封装（自动代理优先级生成 / 智慧代理实时决策）
// API 配置存于 profile.ai：{ endpoint, apiKey, model }
import { G } from '../state.js'
import { EVENTS } from '../data/events.js'
import { NORMAL_POOL, TRANSLATORS } from '../data/translators.js'
import { OPERATORS as OPERATOR_LIST } from '../data/operators.js'
import { WEAPONS as WEAPON_LIST } from '../data/weapons.js'

const hasApi = typeof window !== 'undefined' && window.api

export function aiConfigured() {
  const ai = G.profile.ai
  return !!(ai?.endpoint && ai?.apiKey && ai?.model)
}

// 底层对话调用
export async function aiChat(messages, temperature = 0.3) {
  const ai = G.profile.ai
  if (!aiConfigured()) return { ok: false, error: 'AI未配置：请在设置界面填写接口地址、密钥与模型' }
  if (!hasApi) return { ok: false, error: 'AI功能仅在桌面应用内可用' }
  return window.api.aiChat({ endpoint: ai.endpoint, apiKey: ai.apiKey, model: ai.model, messages, temperature })
}

// ── 自动代理：AI编写优先级 ──
// preferenceText：玩家策略偏向（可为空=AI自由发挥）
// 返回 { ok, config?, name?, error? }
export async function generateAgentConfig(preferenceText, baseConfig) {
  const schema = buildConfigSchema()
  const sys = [
    '你是一个回合制肉鸽游戏的策略设计师。游戏机制：干员携带骰池进行1v1回合制战斗（骰子类型决定行动），',
    '局内货币为"通量"，成长系统为"转译器"（普通转译器商店购买，高阶转译器BOSS战后三选一，核心转译器可装入3个核心槽）。',
    '行动线每5层一个循环：战斗→战斗→特殊节点(事件/商店/奖励关轮换)→战斗→BOSS。战斗胜利后生命仅小幅回复(10%)。',
    '',
    '请输出自动协议方案的配置JSON，并给方案起一个简短贴切的名字（8字以内）。',
    '必须只输出一个JSON对象（含 name 与 config 两字段），不要包含任何其他文字或markdown代码块标记。',
    '',
    '配置结构（全部字段可省略，省略则保持默认）：',
    schema
  ].join('\n')
  const user = baseConfig
    ? `现有方案配置如下（可在其基础上调整）：\n${JSON.stringify(baseConfig)}\n\n${preferenceText?.trim() ? `玩家的调整偏向如下，请严格贯彻：\n${preferenceText}` : '请按你认为更优的策略调整该方案。'}\n\n请输出 {"name": "...", "config": {...}} JSON。`
    : preferenceText?.trim()
      ? `玩家的策略偏向如下，请严格贯彻：\n${preferenceText}\n\n请输出 {"name": "...", "config": {...}} JSON。`
      : '玩家未提供偏向，请按你认为最优的均衡策略输出 {"name": "...", "config": {...}} JSON。'

  const res = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], 0.4)
  if (!res.ok) return res
  const parsed = extractJson(res.content)
  if (!parsed) return { ok: false, error: 'AI输出无法解析为JSON，请重试或更换模型' }
  const config = parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 24) : null
  return { ok: true, config, name, raw: res.content }
}

// ── 进化模式：局末AI调优方案 ──
// runReport：本局完整报告（开局/层数/背包/末场战斗等）
// 返回 { ok, config?, name?, summary?, error? }
export async function evolveAgentScheme(scheme, runReport) {
  const schema = buildConfigSchema()
  const sys = [
    '你是一个回合制肉鸽游戏的策略进化引擎。玩家开启了"进化模式"：每局结束后，你根据本局实战数据调优其自动协议方案，',
    '下一局（连战）将使用调优后的方案，如此循环迭代、不断进化。',
    '调优原则：保留本局表现好的决策，修正导致失败或浪费的选择；开局干员/武器选择也在调优范围内。',
    '必须只输出一个JSON对象：{"name": "方案名(8字内)", "summary": "一句话调优说明(30字内)", "config": {...}}，不要任何其他文字。',
    '',
    '配置结构：',
    schema
  ].join('\n')
  const user = `【当前方案】${scheme.name}\n${JSON.stringify(scheme.config)}\n\n【本局实战报告】\n${JSON.stringify(runReport)}\n\n请输出调优后的方案JSON。`
  const res = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], 0.4)
  if (!res.ok) return res
  const parsed = extractJson(res.content)
  if (!parsed || !parsed.config) return { ok: false, error: 'AI输出无法解析，本局不进化' }
  return {
    ok: true,
    config: parsed.config,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 24) : null,
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 40) : null
  }
}

// ── 智慧代理：开局选择 ──
// 返回 { ok, opening?{operator,weapon}, error? }
export async function smartDecideOpening(context) {
  const ops = OPERATOR_LIST.map((o) => `${o.id}（${o.name}·${o.title}：HP${o.hp} ATK${o.atk}，${o.desc.slice(0, 30)}…）`)
  const wpns = WEAPON_LIST.map((w) => `${w.id}（${w.name}：ATK+${w.atk}，${w.desc.slice(0, 30)}…）`)
  const sys = [
    '你是回合制肉鸽游戏"变量协议"的智慧代理。现在开局编队，请选择干员与武器的组合。',
    '必须只输出JSON：{"operator": "<干员id>", "weapon": "<武器id>"}，不要任何其他文字。',
    '',
    `可选干员：\n${ops.join('\n')}`,
    `可选武器：\n${wpns.join('\n')}`
  ].join('\n')
  const user = `【上一局情报】${JSON.stringify(context)}\n\n请选择本局开局组合，输出JSON。`
  const res = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], 0.4)
  if (!res.ok) return res
  const parsed = extractJson(res.content)
  const operator = OPERATOR_LIST.find((o) => o.id === parsed?.operator)?.id
  const weapon = WEAPON_LIST.find((w) => w.id === parsed?.weapon)?.id
  if (!operator || !weapon) return { ok: false, error: 'AI返回了非法的开局组合' }
  return { ok: true, opening: { operator, weapon } }
}

// 构建供AI参考的配置schema（含全部合法id与说明）
function buildConfigSchema() {
  const eventIds = EVENTS.map((e) => {
    const opts = e.options.map((o, i) => `${i}:${o.label}`).join(' | ')
    return `  "${e.id}"（${e.name}）选项: ${opts}`
  }).join('\n')
  const normalIds = NORMAL_POOL.map((t) => `"${t.id}"(${t.name}:${t.desc.slice(0, 20)}…)`)
  const opIds = OPERATOR_LIST.map((o) => `"${o.id}"(${o.name})`)
  const wpnIds = WEAPON_LIST.map((w) => `"${w.id}"(${w.name})`)
  return `{
  "opening": { "operator": "baseline", "weapon": "standard" },  // 开局选择。干员id合法值：[${opIds.join(', ')}]；武器id合法值：[${wpnIds.join(', ')}]
  "eventPriority": {  // 每个事件的选项优先级。prefer=选项索引数组(最优先在前)；minFlux=执行首选选项所需的最低通量；minHpPct=执行首选选项的最低生命比例(0~1)
${eventIds}
  },
  "shop": {
    "healBelowPct": 0.5,          // 生命低于此比例时优先购买恢复
    "buyPriorities": [...],        // 想购买的普通转译器id数组，顺序即优先级。合法id：[${normalIds.join(', ')}]
    "keepFlux": 60,               // 购物时保留的通量下限
    "buyPoolExpand": true,         // 是否购买骰池扩容
    "buyDicePack": true            // 是否购买临时骰礼包
  },
  "rewardPriority": { "prefer": [0, 1, 2], "healBelowPct": 0.4 },  // 奖励关：0=转译器 1=80通量 2=恢复35%生命
  "bossLoot": {                    // 各BOSS的高阶转译器选择优先级
    "verifier": ["assertModule", "redundantCheck", "exceptionCatch"],
    "recursion": ["tailCall", "memLeak", "stackOverflow"],
    "nullref": ["nullMerge", "lazyEval", "shortCircuit"]
  },
  "corePriority": ["covarianceCore", "entropyEngine", "boundPointer"]  // 核心转译器放置优先级(高在前)，槽满时低优先级会被替换
}`
}

// ── 智慧代理：决策点实时AI决策 ──
// scene: 决策场景描述；options: 选项数组；context: 局面JSON
// 返回 { ok, choice?, error? }；choice=选项索引
export async function smartDecide(scene, options, context) {
  if (!aiConfigured()) return { ok: false, error: 'AI未配置' }
  const opts = options.map((o, i) => `${i}. ${o.label ?? o.name ?? o}`).join('\n')
  const sys = [
    '你是回合制肉鸽游戏"变量协议"的智慧代理，全权替玩家做决策。根据当前局面选择最优选项。',
    '必须只输出JSON：{"choice": <选项索引整数>}，不要任何其他文字。'
  ].join('\n')
  const user = `【决策场景】${scene}\n【当前局面】${JSON.stringify(context)}\n【可选项】\n${opts}\n\n请输出JSON。`
  const res = await aiChat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], 0.2)
  if (!res.ok) return res
  const parsed = extractJson(res.content)
  const choice = parsed?.choice
  if (!Number.isInteger(choice) || choice < 0 || choice >= options.length) {
    return { ok: false, error: `AI返回了非法选择：${res.content.slice(0, 100)}` }
  }
  return { ok: true, choice }
}

// 从AI回复中提取JSON（容忍markdown代码块/前后缀文本）
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  try {
    return JSON.parse(candidate)
  } catch { /* 继续尝试子串 */ }
  // 宽松提取：第一个 { 到最后一个 }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
  }
  return null
}

export { TRANSLATORS }
