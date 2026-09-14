// 个人后台服务器客户端：玩家账号、玩家数据云存档、资源版本增量更新、游戏核心更新
// 配置文件位于 <默认userData>/server.json（仓库外，绝不提交 GitHub）：
//   { "baseUrl": "https://your-server.example", "apiKey": "" }
// 未配置/不可达时所有功能优雅禁用（核心更新检查回落 GitHub Releases）
//
// 资源增量同步协议（v2）：
//   GET /api/resources/latest?core=<核心版本>&resource=<当前资源版本>
//   → { version, minCore, manifest: {路径: sha256(全量)}, changed: {路径: {url, sha256}}, removes: [路径] }
//   服务端按客户端当前版本计算差异；客户端以现有资源为基底仅下载变更文件；
//   客户端版本未知（清单缺失）时服务端返回全量 changed——两种情况客户端处理路径一致
import { app, net, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, cpSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { compareVersions, overlayResourceRoot, baseResourceRoot } from './resources.js'
import { readAccount, writeAccount, clearAccount } from './accountStore.js'

// ── 服务器配置（默认 userData，不随数据目录重定向：属于本机配置而非玩家数据）──
// 默认 userData 推导：%APPDATA%/variable-protocol（与 datapath.json 指针文件同目录）
function defaultServerConfigFile() {
  return join(process.env.APPDATA || dirname(app.getPath('exe')), 'variable-protocol', 'server.json')
}

let cachedConfig
export function backendConfig() {
  if (cachedConfig === undefined) {
    try {
      let text = readFileSync(defaultServerConfigFile(), 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      const c = JSON.parse(text)
      cachedConfig = { baseUrl: String(c.baseUrl || '').replace(/\/+$/, ''), apiKey: String(c.apiKey || '') }
    } catch {
      cachedConfig = { baseUrl: '', apiKey: '' }
    }
  }
  return cachedConfig
}

export function backendConfigured() {
  return !!backendConfig().baseUrl
}

// ── 请求封装 ──
async function api(path, { method = 'GET', body, auth = false, timeout = 15000 } = {}) {
  const cfg = backendConfig()
  if (!cfg.baseUrl) return { ok: false, disabled: true, error: '未配置服务器' }
  const headers = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers['X-Api-Key'] = cfg.apiKey
  if (auth) {
    const acc = readAccount()
    if (!acc) return { ok: false, error: '尚未登录' }
    headers.Authorization = `Bearer ${acc.token}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await net.fetch(cfg.baseUrl + path, {
      method, headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '请求超时' : String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

// ── 账号 ──
// 密码预哈希：登录/注册仅传输 SHA-256 十六进制摘要而非明文。
// 背景：HTTP 直连 IP 场景下防链路嗅探——玩家复用的原始密码不泄露（主要风险）；
// 服务端对收到的字符串照常 scrypt 存储，无需感知预哈希，未来升级 HTTPS 亦兼容。
// 注意：哈希后服务端无法校验密码长度，密码策略（6~64 位）在客户端发送前执行。
function prehashPassword(password) {
  return createHash('sha256').update(String(password), 'utf-8').digest('hex')
}

function checkCredentials(username, password) {
  if (!username || !password) return '用户名与密码不能为空'
  if (String(password).length < 6 || String(password).length > 64) return '密码长度需为 6~64 位'
  return null
}

export async function serverLogin(username, password) {
  const err = checkCredentials(username, password)
  if (err) return { ok: false, error: err }
  const r = await api('/api/auth/login', { method: 'POST', body: { username, password: prehashPassword(password) } })
  if (r.ok) writeAccount({ username, token: r.data.token })
  return r
}

// 注册并自动登录
export async function serverRegister(username, password) {
  const err = checkCredentials(username, password)
  if (err) return { ok: false, error: err }
  const r = await api('/api/auth/register', { method: 'POST', body: { username, password: prehashPassword(password) } })
  if (r.ok) writeAccount({ username, token: r.data.token })
  return r
}

export function serverLogout() {
  clearAccount()
  return { ok: true }
}

export function accountState() {
  const acc = readAccount()
  return { configured: backendConfigured(), loggedIn: !!acc, username: acc?.username || null }
}

// ── 核心更新查询（供 updater.js 的服务器优先提供者；sha256 供下载完成后校验）──
export async function checkCoreUpdate() {
  const r = await api(`/api/core/latest?core=${encodeURIComponent(app.getVersion())}`)
  if (!r.ok) return r
  const latest = r.data
  if (!latest?.version) return { ok: false, error: '服务器响应缺少版本号' }
  return {
    ok: true,
    current: app.getVersion(),
    latest: {
      version: latest.version,
      name: latest.name || '',
      url: latest.url || '',
      notes: String(latest.notes || '').slice(0, 6000),
      publishedAt: latest.publishedAt || '',
      downloadUrl: latest.downloadUrl || null,
      fileName: latest.fileName || null,
      sha256: latest.sha256 || null
    },
    updateAvailable: compareVersions(latest.version, app.getVersion()) > 0
  }
}

// ── 资源更新检查：归一化增量协议（changed/removes 缺省时按全量处理，兼容旧/mock 服务端）──
export async function checkResourceUpdate(currentResourceVersion) {
  const r = await api(`/api/resources/latest?core=${encodeURIComponent(app.getVersion())}&resource=${encodeURIComponent(currentResourceVersion || '0')}`)
  if (!r.ok) return r
  const data = r.data
  if (!data?.version) return { ok: true, update: null }
  if (compareVersions(data.minCore || '0', app.getVersion()) > 0) {
    return { ok: false, error: `资源包 v${data.version} 需要先更新客户端核心（要求 ≥ v${data.minCore}）` }
  }
  const changed = data.changed || data.files || {}
  const manifest = data.manifest
    || Object.fromEntries(Object.entries(changed).map(([p, i]) => [p, i?.sha256 ?? i]))
  return {
    ok: true,
    update: {
      version: data.version,
      minCore: data.minCore || '0',
      changed,       // {路径: {url, sha256}} 仅需下载的文件
      manifest,      // {路径: sha256} 新版本全量清单（写入覆盖层 manifest.json）
      removes: data.removes || [] // 新版本已删除的文件路径
    }
  }
}

let resourceApplyListener = null
export function setResourceApplyListener(fn) { resourceApplyListener = fn }
function pushApply(p) { resourceApplyListener?.(p) }

// ── 资源更新应用（增量）──
// 基底 = 当前覆盖层（存在时）或安装基线 → 暂存目录 → 下载变更文件覆盖 → 删除移除文件
// → 写入新版全量清单 → 原子替换覆盖层。任何一步失败：清理暂存、保留当前可用版本。
export async function applyResourceUpdate(update) {
  const changed = Object.entries(update.changed || {})
  const removes = update.removes || []
  const manifest = update.manifest || {}
  if (Object.keys(manifest).length === 0) return { ok: false, error: '资源清单为空' }
  const overlay = overlayResourceRoot()
  const staging = join(dirname(overlay), 'game-staging')
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    // 增量基底：未变更文件无需下载，直接复制现有资源
    const seed = existsSync(overlay) ? overlay : baseResourceRoot()
    if (existsSync(seed)) cpSync(seed, staging, { recursive: true })
    let done = 0
    for (const [rel, info] of changed) {
      const target = join(staging, ...rel.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      // 下载（net.fetch 走系统证书/代理）
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120000)
      let buf
      try {
        const res = await net.fetch(info.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        buf = Buffer.from(await res.arrayBuffer())
      } finally {
        clearTimeout(timer)
      }
      // sha256 校验
      const sha = createHash('sha256').update(buf).digest('hex')
      if (info.sha256 && sha !== info.sha256) {
        throw new Error(`文件校验失败：${rel}`)
      }
      writeFileSync(target, buf)
      done++
      pushApply({ done, total: changed.length, file: rel })
    }
    // 移除新版本已删除的文件
    for (const rel of removes) {
      try { rmSync(join(staging, ...rel.split('/'))) } catch { /* 不存在则忽略 */ }
    }
    // 写入新版全量清单（供启动版本判定与下次增量 diff 基准）
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify({
      format: 1, version: update.version, minCore: update.minCore || '0', files: manifest
    }, null, 2), 'utf-8')
    // 原子替换覆盖层：staging → game（覆盖层仅是可重建的资源缓存，不含用户数据）
    if (existsSync(overlay)) {
      try { rmSync(overlay, { recursive: true, force: true }) } catch { /* 替换失败则报错回退 */ }
    }
    mkdirSync(dirname(overlay), { recursive: true })
    renameSync(staging, overlay)
    return { ok: true, version: update.version, files: changed.length }
  } catch (err) {
    // 失败清理：保留当前可用版本
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* 忽略 */ }
    return { ok: false, error: `资源更新失败：${err?.message || err}（已保留当前版本）` }
  }
}

// ── 玩家数据云存档 ──
export async function pushPlayerData() {
  const acc = readAccount()
  if (!acc) return { ok: false, error: '尚未登录' }
  const file = join(app.getPath('userData'), 'saves', 'profile.json')
  let profile = null
  try {
    let text = readFileSync(file, 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    profile = JSON.parse(text)
  } catch {
    return { ok: false, error: '本地存档不存在或损坏' }
  }
  return api('/api/player/data', { method: 'PUT', auth: true, body: { profile, clientVersion: app.getVersion() } })
}

export async function pullPlayerData() {
  const r = await api('/api/player/data', { auth: true })
  if (!r.ok) return r
  if (!r.data?.profile) return { ok: false, error: '云端没有存档数据' }
  const saves = join(app.getPath('userData'), 'saves')
  mkdirSync(saves, { recursive: true })
  // 恢复前本地自动备份
  const local = join(saves, 'profile.json')
  if (existsSync(local)) {
    writeFileSync(join(saves, `profile.backup-${Date.now()}.json`), readFileSync(local), 'utf-8')
  }
  writeFileSync(local, JSON.stringify(r.data.profile, null, 2), 'utf-8')
  return { ok: true }
}

// ── IPC 面 ──
export function registerBackendIpc() {
  ipcMain.handle('server:status', () => ({ ...accountState(), baseUrl: backendConfig().baseUrl || null }))
  ipcMain.handle('server:login', (_e, { username, password }) => serverLogin(username, password))
  ipcMain.handle('server:register', (_e, { username, password }) => serverRegister(username, password))
  ipcMain.handle('server:logout', () => serverLogout())
  ipcMain.handle('cloud:push', () => pushPlayerData())
  ipcMain.handle('cloud:pull', () => pullPlayerData())
  ipcMain.handle('server:checkResourceUpdate', async (_e, currentVersion) => {
    const r = await checkResourceUpdate(currentVersion)
    return r
  })
  ipcMain.handle('server:applyResourceUpdate', (_e, update) => applyResourceUpdate(update))
}
