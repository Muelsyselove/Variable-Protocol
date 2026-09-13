// 全局状态与存档
import { serializeRun, deserializeRun } from './core/run.js'
import { setRngState, rngState } from './core/rng.js'
import { sanitizeSchemes } from './core/schemes.js'

export const G = {
  run: null,
  hasSave: false,
  lastBattle: null,   // 末场战斗信息（进化模式报告用）
  profile: {
    bestLayer: 0, totalRuns: 0, totalKills: 0,
    coins: 0,                                            // 局外货币：算力币
    pet: { owned: {}, active: null, food: 0, satiety: {}, affection: {}, lastDecay: 0, lastInteract: 0 },  // 桌宠仓库
    sound: { enabled: true, volume: 0.8 },               // 音效配置
    schemes: [],                                         // 自动协议方案池（core/schemes.js 管理）
    activeSchemeId: null,                                // 当前激活方案
    evolution: false,                                    // 进化模式：局末AI调优方案
    chainBattle: false,                                  // 连战：局末自动开局下一局
    ai: { endpoint: '', apiKey: '', model: '' },      // AI接口配置（OpenAI兼容）
    agentConfig: null                                  // 激活方案镜像（schemes.js 同步维护）
  }
}

const hasApi = typeof window !== 'undefined' && window.api

// 桌宠仓库兜底（旧存档兼容）
function sanitizePet(p) {
  const base = { owned: {}, active: null, food: 0, satiety: {}, affection: {}, lastDecay: 0, lastInteract: 0 }
  const pet = { ...base, ...(p || {}) }
  pet.owned = pet.owned && typeof pet.owned === 'object' ? pet.owned : {}
  pet.satiety = pet.satiety && typeof pet.satiety === 'object' ? pet.satiety : {}
  pet.affection = pet.affection && typeof pet.affection === 'object' ? pet.affection : {}
  return pet
}

// 饱食度随真实时间衰减（每30分钟 -1，下限0），在读取存档与渲染桌宠前调用
export function decayPetSatiety() {
  const pet = G.profile.pet
  const now = Date.now()
  const last = pet.lastDecay || now
  const hours = (now - last) / 1800000 // 30分钟为单位
  if (hours >= 1) {
    const drop = Math.floor(hours)
    for (const id of Object.keys(pet.satiety)) pet.satiety[id] = Math.max(0, (pet.satiety[id] || 0) - drop)
    pet.lastDecay = last + drop * 1800000
  } else if (!pet.lastDecay) {
    pet.lastDecay = now
  }
}

export async function initProfile() {
  if (!hasApi) return
  const p = await window.api.readSave('profile.json')
  if (p) {
    G.profile = { ...G.profile, ...p }
    G.profile.ai = { endpoint: '', apiKey: '', model: '', ...(G.profile.ai || {}) }
    G.profile.sound = { enabled: true, volume: 0.8, ...(G.profile.sound || {}) }
    G.profile.pet = sanitizePet(G.profile.pet)
    G.profile.coins = Math.max(0, Math.floor(Number(G.profile.coins) || 0))
    if (G.profile.miniStyle !== 'pet') G.profile.miniStyle = 'hub'
    G.profile.evolution = !!G.profile.evolution
    G.profile.chainBattle = !!G.profile.chainBattle
  } else if (new URLSearchParams(location.search).get('pkg') === '1') {
    // 打包版新档开局赠礼：赠送 1000 算力币（仅首次建档，旧档/开发版不受影响）
    G.profile.coins = 1000
  }
  // 方案池：迁移旧 agentConfig → 首个方案，校验激活项并同步镜像
  sanitizeSchemes(G.profile)
  decayPetSatiety()
  G.hasSave = !!(await window.api.readSave('run.json'))
}

export async function saveProfile() {
  if (!hasApi) return
  await window.api.writeSave('profile.json', G.profile)
}

export async function saveRun() {
  if (!hasApi || !G.run) return
  G.hasSave = true
  await window.api.writeSave('run.json', serializeRun(G.run))
}

export async function loadRun() {
  if (!hasApi) return false
  const data = await window.api.readSave('run.json')
  if (!data) return false
  G.run = deserializeRun(data)
  setRngState(G.run.rngState ?? G.run.seed ?? 12345)
  return true
}

// 是否存在局内存档（用于主菜单“继续行动”可用性）
export function hasRunSave() {
  return G.hasSave
}

export async function clearRun() {
  if (!hasApi) return
  await window.api.deleteSave('run.json')
  G.run = null
  G.hasSave = false
}

// 战斗内保存随机数状态（供断点续玩使用）
export function snapshotRng() {
  if (G.run) G.run.rngState = rngState()
}

// ── 自动协议（三档：自动协议/自动代理/智慧代理） ──
export const PROTOCOLS = [
  { id: 'auto', name: '自动协议', available: true, desc: '自动进入战斗节点与各节点界面，战斗胜利后自动返回；事件选项、商店购买、奖励关与转译器选择仍需手动操作。' },
  { id: 'agent', name: '自动代理', available: true, desc: '自动协议的增强版：系统自动推进所有节点，并在决策点按优先级配置自动选择——事件选项、商店购买、奖励关、BOSS掉落与核心放置全部自动。优先级可在设置界面调整或由AI编写。' },
  { id: 'smart', name: '智慧代理', available: true, desc: '自动协议的高级版：系统自动推进所有节点；仅在系统无法自动的决策点（事件选项、奖励关选择、BOSS高阶转译器三选一）由AI实时决策，AI不可用时回落优先级。' }
]

export function protocolName(id) {
  return PROTOCOLS.find((p) => p.id === id)?.name || '自动协议'
}

// 是否有协议正在运行
export function protocolActive() {
  return !!G.run && G.run.settings.protocol !== 'none'
}

// 应用窗口状态（小窗/置顶）：启动恢复与切换共用
export function applyWindowState() {
  if (!G.run) return
  document.body.classList.toggle('mini-mode', !!G.run.settings.mini)
  if (hasApi) {
    window.api.setMini(!!G.run.settings.mini)
    window.api.setAlwaysOnTop(!!G.run.settings.alwaysOnTop)
  }
}
