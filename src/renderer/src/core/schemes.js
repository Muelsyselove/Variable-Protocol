// 自动协议方案池：多方案 CRUD + 激活切换 + 开局选择
// 方案 = { id, name, config }，config 含原 agentConfig 字段 + opening 开局选择
// G.profile.agentConfig 保留为「当前激活方案」的镜像，agentRunner 等既有引用无需改动
import { G, saveProfile } from '../state.js'
import { defaultAgentConfig, sanitizeAgentConfig } from './agentConfig.js'

// ── 迁移与兜底（initProfile 时调用） ──
export function sanitizeSchemes(profile) {
  let schemes = Array.isArray(profile.schemes) ? profile.schemes : []
  // 旧档案迁移：agentConfig（或默认）转为首个方案「默认方案」
  if (schemes.length === 0) {
    const legacy = sanitizeAgentConfig(profile.agentConfig || defaultAgentConfig())
    schemes = [makeScheme('默认方案', legacy)]
  }
  schemes = schemes
    .filter((s) => s && s.id && s.config)
    .map((s) => ({ ...s, name: String(s.name || '未命名方案').slice(0, 24), config: sanitizeAgentConfig(s.config) }))
  profile.schemes = schemes
  // 激活方案校验：无效则回退首个
  if (!schemes.some((s) => s.id === profile.activeSchemeId)) {
    profile.activeSchemeId = schemes[0]?.id || null
  }
  syncAgentConfig(profile)
}

// 激活方案内容镜像到 profile.agentConfig（agentRunner 的单一读取口）
export function syncAgentConfig(profile = G.profile) {
  const sch = getScheme(profile.activeSchemeId, profile)
  profile.agentConfig = sch ? sch.config : sanitizeAgentConfig(defaultAgentConfig())
  return profile.agentConfig
}

// ── 工具 ──
export function makeScheme(name, config) {
  return {
    id: 'sch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(name || '未命名方案').slice(0, 24),
    config: sanitizeAgentConfig(config),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

export function getSchemes(profile = G.profile) {
  return profile.schemes || []
}

export function getScheme(id, profile = G.profile) {
  return (profile.schemes || []).find((s) => s.id === id) || null
}

export function getActiveScheme(profile = G.profile) {
  return getScheme(profile.activeSchemeId, profile)
}

// ── CRUD（均即时持久化） ──
export async function createScheme(name, config) {
  const sch = makeScheme(name, config)
  G.profile.schemes.push(sch)
  await saveProfile()
  return sch
}

// 整体替换方案内容（AI调整/进化后调用）
export async function updateScheme(id, { name, config }) {
  const sch = getScheme(id)
  if (!sch) return null
  if (name != null) sch.name = String(name).slice(0, 24)
  if (config != null) sch.config = sanitizeAgentConfig(config)
  sch.updatedAt = Date.now()
  if (id === G.profile.activeSchemeId) syncAgentConfig()
  await saveProfile()
  return sch
}

export async function renameScheme(id, name) {
  return updateScheme(id, { name })
}

export async function deleteScheme(id) {
  const schemes = G.profile.schemes
  const idx = schemes.findIndex((s) => s.id === id)
  if (idx < 0) return false
  // 至少保留一个方案：删除最后一个时自动补默认方案
  schemes.splice(idx, 1)
  if (schemes.length === 0) {
    schemes.push(makeScheme('默认方案', defaultAgentConfig()))
  }
  if (G.profile.activeSchemeId === id) {
    G.profile.activeSchemeId = schemes[0].id
    syncAgentConfig()
  }
  await saveProfile()
  return true
}

// 激活方案（同时更新 agentConfig 镜像）
export async function activateScheme(id) {
  if (!getScheme(id)) return false
  G.profile.activeSchemeId = id
  syncAgentConfig()
  await saveProfile()
  return true
}
