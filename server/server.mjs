#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// 变量协议 · 个人后台服务器（生产版，零依赖，Node ≥ 18）
//
// 启动：node server/server.mjs   （或 npm run server）
// 环境变量：
//   PORT      监听端口（默认 8787）
//   HOST      监听地址（默认 0.0.0.0）
//   DATA_DIR  数据目录（默认 <本文件目录>/data；含用户/云端存档/资源包，勿入库勿外传）
//   API_KEY   接入密钥（可选；设置后客户端 server.json 的 apiKey 必须一致）
//
// 接口（与客户端 src/main/backend.js / updater.js 约定）：
//   POST   /api/auth/register          注册 {username(纯英文), password} → {token, username, account(11位数字账号)}
//   POST   /api/auth/login             登录 {username: 11位账号或旧版用户名, password} → {token, username, account}
//   GET    /api/auth/me                当前会话信息 {username, account}（Bearer）
//   PUT    /api/auth/password          修改密码 {oldPassword, newPassword}（Bearer）→ {token(旧令牌全部失效)}
//   DELETE /api/auth/account           注销账号 {password}（Bearer）：永久删除用户与云端存档
//   GET    /api/announcements          公告列表（分类：system 系统通知 / game 游戏公告；admin CLI 维护，逐请求读磁盘免重启）
//   GET    /api/mail                   当前用户邮件列表（Bearer；含未领取附件状态）
//   POST   /api/mail/claim             领取邮件附件 {id}（Bearer；服务端标记已领取，防重复领取）
//   GET    /api/core/latest?core=      最新核心版本（含下载地址与 sha256；未发布 → 404）
//   GET    /api/resources/latest?core=&resource=  资源增量差异（见下）
//   GET    /packages/resources/<版本>/<路径>       资源文件（支持 Range 断点续传）
//   GET    /cores/<版本>/<文件>                     核心安装包（支持 Range）
//   GET/PUT /api/player/data       玩家云存档（Bearer 鉴权）
//
// 账号体系（v2.1.0 起）：注册仅填用户名（纯英文字母）与密码，服务端自动分配 11 位纯数字账号；
// 登录使用账号（兼容旧版用户名登录）。
//
// 资源增量协议：服务端保存每个已发布版本的完整清单（路径→sha256）。
// 客户端携带当前资源版本查询时，返回 {version, minCore, manifest(全量),
// changed(仅哈希不同的文件), removes(新版本已删除的路径)}；
// 客户端版本未知（早于服务端记录）时返回全量 changed。
//
// 版本发布 / 用户管理：node server/admin.mjs（见其 --help 或文件头注释）
// HTTPS：公网部署请前置 Caddy 反向代理（自动 Let's Encrypt），本服务保持 HTTP
// ══════════════════════════════════════════════════════════════════════
import { createServer } from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream, renameSync } from 'node:fs'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, 'data'))
const API_KEY = process.env.API_KEY || ''
const GITHUB_RELEASES = 'https://github.com/Muelsyselove/Variable-Protocol/releases/latest'

const USERS_FILE = join(DATA_DIR, 'users.json')
const PLAYERS_FILE = join(DATA_DIR, 'players.json')
const VERSIONS_FILE = join(DATA_DIR, 'versions.json')
const ANNOUNCEMENTS_FILE = join(DATA_DIR, 'announcements.json')
const MAILS_FILE = join(DATA_DIR, 'mails.json')
const PACKAGES_DIR = join(DATA_DIR, 'packages', 'resources')
const CORES_DIR = join(DATA_DIR, 'cores')
for (const d of [DATA_DIR, PACKAGES_DIR, CORES_DIR]) mkdirSync(d, { recursive: true })

// ── JSON 存储（原子写：临时文件 + 重命名）──
function loadJSON(file, fallback) {
  try {
    let t = readFileSync(file, 'utf-8')
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    return JSON.parse(t)
  } catch {
    return fallback
  }
}
function saveJSON(file, data) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

const users = loadJSON(USERS_FILE, { users: {} })
const players = loadJSON(PLAYERS_FILE, {})
// versions 每次请求时从磁盘读取：admin CLI 发布/移除版本后服务无需重启即生效
// （文件仅 KB 级，读取成本可忽略；users/players 保持启动缓存——写路径在服务内，内存即真源）
function currentVersions() {
  return loadJSON(VERSIONS_FILE, { resources: {}, cores: {} })
}

// ── 工具 ──
function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.\-+]/)
  const pb = String(b || '0').split(/[.\-+]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0
    const nb = parseInt(pb[i], 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  })
  res.end(body)
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let len = 0
    req.on('data', (c) => {
      len += c.length
      if (len > limit) { req.destroy(); return resolve(null) }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve(null))
  })
}

// ── 账号：scrypt 密码哈希 + Bearer 令牌（多设备令牌，每用户上限 10 个）──
function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 32).toString('hex')
}
function verifyPassword(password, salt, hash) {
  try {
    const h = Buffer.from(hash, 'hex')
    const c = scryptSync(String(password), salt, 32)
    return h.length === c.length && timingSafeEqual(h, c)
  } catch {
    return false
  }
}
function mintToken(user) {
  const token = randomBytes(24).toString('hex')
  user.tokens = [...(user.tokens || []), token].slice(-10)
  return token
}
function authUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  for (const [name, u] of Object.entries(users.users)) {
    if (u.tokens?.includes(token)) return { name, token }
  }
  return null
}

// ── 11 位纯数字账号（首位非 0，全服唯一）──
function genAccountNumber() {
  const existing = new Set(Object.values(users.users).map((u) => u.account).filter(Boolean))
  for (;;) {
    let n = String(1 + Math.floor(Math.random() * 9))
    for (let i = 0; i < 10; i++) n += Math.floor(Math.random() * 10)
    if (!existing.has(n)) return n
  }
}

// 启动迁移：旧用户（无账号）补发；v2.1.0 前注册的用户可继续用用户名登录，
// 也可让管理员经 admin user-list 查询账号后改用账号登录
{
  let changed = false
  for (const u of Object.values(users.users)) {
    if (!u.account) { u.account = genAccountNumber(); changed = true }
  }
  if (changed) saveJSON(USERS_FILE, users)
}

// 注册校验：用户名纯英文字母 2~24 位（v2.1.0 起）
function validNewUsername(name) {
  return typeof name === 'string' && /^[A-Za-z]{2,24}$/.test(name)
}
// 密码长度校验：注册/改密入口校验（客户端传输 SHA-256 预哈希时恒通过，内容策略由客户端执行）
function validPassword(pass) {
  return typeof pass === 'string' && pass.length >= 6 && pass.length <= 64
}

// ── 登录/注册限流：30 次/分钟/IP ──
const attempts = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const e = attempts.get(ip)
  if (!e || now > e.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60000 })
    return false
  }
  e.count++
  return e.count > 30
}

// ── 静态文件服务（支持 Range 断点续传）──
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.json': 'application/json', '.txt': 'text/plain',
  '.exe': 'application/octet-stream', '.zip': 'application/zip'
}
function safePath(root, parts) {
  const p = resolve(join(root, ...parts))
  return p.startsWith(resolve(root)) ? p : null
}
function serveFile(req, res, filePath) {
  const stat = statSync(filePath)
  const headers = {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  }
  const range = req.headers.range
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    let start = m[1] === '' ? undefined : parseInt(m[1], 10)
    let end = m[2] === '' ? undefined : parseInt(m[2], 10)
    if (start === undefined) { // 后缀范围：bytes=-N
      start = Math.max(0, stat.size - (end || 0))
      end = stat.size - 1
    } else {
      end = Math.min(end ?? stat.size - 1, stat.size - 1)
    }
    if (start >= 0 && start <= end) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1
      })
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
    return res.end()
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  createReadStream(filePath).pipe(res)
}

// ══════════════════ 路由 ══════════════════
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const path = decodeURIComponent(u.pathname)
    const ip = req.socket.remoteAddress || '?'

    if (req.method === 'OPTIONS') return json(res, 204, {})
    // 接入密钥（配置时校验全部 /api/ 请求；静态文件不受限）
    if (API_KEY && path.startsWith('/api/') && req.headers['x-api-key'] !== API_KEY) {
      return json(res, 401, { error: 'API key 无效' })
    }

    // ── 健康检查 ──
    if (req.method === 'GET' && path === '/api/health') {
      return json(res, 200, { ok: true, uptime: process.uptime(), dataDir: DATA_DIR })
    }

    // ── 注册 / 登录（限流）──
    if (req.method === 'POST' && (path === '/api/auth/register' || path === '/api/auth/login')) {
      if (rateLimited(ip)) return json(res, 429, { error: '请求过于频繁，请稍后再试' })
      const body = (await readBody(req, 4096)) || {}
      const { username, password } = body
      if (!validPassword(password)) return json(res, 400, { error: '密码长度需为 6~64 位' })
      if (path === '/api/auth/register') {
        if (!validNewUsername(username)) return json(res, 400, { error: '用户名需为 2~24 位纯英文字母' })
        if (users.users[username]) return json(res, 409, { error: '用户名已被注册' })
        const salt = randomBytes(16).toString('hex')
        const user = { salt, hash: hashPassword(password, salt), tokens: [], createdAt: Date.now(), account: genAccountNumber() }
        users.users[username] = user
        saveJSON(USERS_FILE, users)
        return json(res, 200, { ok: true, token: mintToken(user), username, account: user.account })
      }
      // 登录：11 位数字按账号查，否则按用户名查（旧版兼容）
      const key = String(username || '')
      let name = null
      if (/^\d{11}$/.test(key)) {
        name = Object.keys(users.users).find((n) => users.users[n].account === key) || null
      } else if (users.users[key]) {
        name = key
      }
      const user = name ? users.users[name] : null
      if (!user || !verifyPassword(password, user.salt, user.hash)) {
        return json(res, 401, { error: '账号或密码错误' })
      }
      saveJSON(USERS_FILE, users)
      return json(res, 200, { ok: true, token: mintToken(user), username: name, account: user.account })
    }

    // ── 当前会话信息（Bearer）：补全/校验本机登录态（如旧版本登录时未存账号号）──
    if (req.method === 'GET' && path === '/api/auth/me') {
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      const user = users.users[auth.name]
      return json(res, 200, { ok: true, username: auth.name, account: user?.account || null })
    }

    // ── 修改密码（Bearer + 原密码验证；成功后旧令牌全部失效，返回新令牌）──
    if (req.method === 'PUT' && path === '/api/auth/password') {
      if (rateLimited(ip)) return json(res, 429, { error: '请求过于频繁，请稍后再试' })
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      const body = (await readBody(req, 4096)) || {}
      const user = users.users[auth.name]
      if (!user || !verifyPassword(body.oldPassword || '', user.salt, user.hash)) {
        return json(res, 400, { error: '原密码错误' })
      }
      if (!validPassword(body.newPassword)) return json(res, 400, { error: '新密码长度需为 6~64 位' })
      const salt = randomBytes(16).toString('hex')
      user.salt = salt
      user.hash = hashPassword(body.newPassword, salt)
      user.tokens = []
      saveJSON(USERS_FILE, users)
      return json(res, 200, { ok: true, token: mintToken(user) })
    }

    // ── 注销账号（永久删除用户与云端存档，需密码确认）──
    if (req.method === 'DELETE' && path === '/api/auth/account') {
      if (rateLimited(ip)) return json(res, 429, { error: '请求过于频繁，请稍后再试' })
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      const body = (await readBody(req, 4096)) || {}
      const user = users.users[auth.name]
      if (!user || !verifyPassword(body.password || '', user.salt, user.hash)) {
        return json(res, 400, { error: '密码错误' })
      }
      delete users.users[auth.name]
      delete players[auth.name]
      saveJSON(USERS_FILE, users)
      saveJSON(PLAYERS_FILE, players)
      return json(res, 200, { ok: true })
    }

    // ── 公告（admin CLI 维护 announcements.json；逐请求读磁盘，发布后免重启）──
    // 分类：system 系统通知（版本更新/调整细节）、game 游戏公告（新增内容/更新前瞻）。
    // 旧数据无 category 字段按 system 处理（v2.2.0 前公告均为更新调整类）。旧客户端忽略
    // category 字段照常展示，保持向后兼容。
    if (req.method === 'GET' && path === '/api/announcements') {
      const ann = loadJSON(ANNOUNCEMENTS_FILE, { list: [] })
      const list = Array.isArray(ann.list) ? ann.list : []
      const pick = (cat) => list
        .filter((a) => (a.category === 'game' ? 'game' : 'system') === cat)
        .sort((x, y) => (Number(y.id) || 0) - (Number(x.id) || 0))
        .slice(0, 20)
      return json(res, 200, { ok: true, announcements: [...pick('system'), ...pick('game')] })
    }

    // ── 邮件（admin CLI 维护 mails.json；Bearer 鉴权，按用户可见）──
    // 存储：{ list: [{ id, to: 'all'|<用户名>, title, from, body, attachments, date, expiresAt, claimed: {用户名: 时间戳} }] }
    // 附件：[{ type: 'coins'|'food'|'pet', amount?, id? }]，语义由客户端解释入账。
    if (req.method === 'GET' && path === '/api/mail') {
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      const store = loadJSON(MAILS_FILE, { list: [] })
      const all = Array.isArray(store.list) ? store.list : []
      const now = Date.now()
      // 过期邮件全局清理（读取时顺带执行，免维护定时任务）
      const alive = all.filter((m) => !m.expiresAt || m.expiresAt > now)
      if (alive.length !== all.length) {
        store.list = alive
        saveJSON(MAILS_FILE, store)
      }
      const mails = alive
        .filter((m) => m.to === 'all' || m.to === auth.name)
        .sort((x, y) => (Number(y.id) || 0) - (Number(x.id) || 0))
        .slice(0, 50)
        .map((m) => ({
          id: m.id, title: m.title, from: m.from || '', body: m.body || '',
          attachments: Array.isArray(m.attachments) ? m.attachments : [],
          date: m.date, expiresAt: m.expiresAt || null,
          claimed: !!m.claimed?.[auth.name]
        }))
      return json(res, 200, { ok: true, mails })
    }

    // ── 领取邮件附件（服务端标记 claimed，多设备/重装不重复发放）──
    if (req.method === 'POST' && path === '/api/mail/claim') {
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      const body = (await readBody(req, 4096)) || {}
      const store = loadJSON(MAILS_FILE, { list: [] })
      const mail = (Array.isArray(store.list) ? store.list : [])
        .find((m) => Number(m.id) === Number(body.id))
      if (!mail) return json(res, 404, { error: '邮件不存在或已过期' })
      if (mail.to !== 'all' && mail.to !== auth.name) return json(res, 404, { error: '邮件不存在或已过期' })
      if (mail.expiresAt && mail.expiresAt <= Date.now()) return json(res, 410, { error: '邮件已过期' })
      mail.claimed = mail.claimed && typeof mail.claimed === 'object' ? mail.claimed : {}
      if (mail.claimed[auth.name]) return json(res, 409, { error: '附件已领取' })
      mail.claimed[auth.name] = Date.now()
      saveJSON(MAILS_FILE, store)
      return json(res, 200, { ok: true, attachments: Array.isArray(mail.attachments) ? mail.attachments : [] })
    }

    // ── 核心更新查询：已发布的最高版本 ──
    if (req.method === 'GET' && path === '/api/core/latest') {
      const versions = currentVersions()
      const latest = Object.keys(versions.cores).sort(compareVersions).pop()
      if (!latest) return json(res, 404, { error: '服务器未发布核心版本' })
      const c = versions.cores[latest]
      return json(res, 200, {
        version: latest,
        name: c.name || '',
        notes: c.notes || '',
        url: c.url || GITHUB_RELEASES,
        downloadUrl: `/cores/${latest}/${c.file}`,
        fileName: c.file,
        sha256: c.sha256,
        size: c.size,
        publishedAt: c.publishedAt
      })
    }

    // ── 资源更新查询：增量差异 ──
    if (req.method === 'GET' && path === '/api/resources/latest') {
      const versions = currentVersions()
      const latest = Object.keys(versions.resources).sort(compareVersions).pop()
      if (!latest) return json(res, 200, {}) // 无已发布资源 → 无更新
      const entry = versions.resources[latest]
      const clientVer = u.searchParams.get('resource') || '0'
      // 客户端已不低于最新版本 → 无更新
      if (compareVersions(clientVer, latest) >= 0) return json(res, 200, {})
      const base = versions.resources[clientVer]
      let changed, removes
      if (base) {
        // 增量：仅哈希不同的文件需要下载；新版本中不存在的路径需要删除
        changed = {}
        for (const [p, sha] of Object.entries(entry.files)) {
          if (base.files[p] !== sha) changed[p] = { url: `/packages/resources/${latest}/${p}`, sha256: sha }
        }
        removes = Object.keys(base.files).filter((p) => !(p in entry.files))
      } else {
        // 客户端版本未知（早于服务端记录）→ 全量
        changed = Object.fromEntries(Object.entries(entry.files).map(([p, sha]) => [p, { url: `/packages/resources/${latest}/${p}`, sha256: sha }]))
        removes = []
      }
      return json(res, 200, {
        version: latest,
        minCore: entry.minCore || '0',
        manifest: entry.files,
        changed,
        removes
      })
    }

    // ── 资源文件下发 ──
    if (req.method === 'GET' && path.startsWith('/packages/resources/')) {
      const rest = path.slice('/packages/resources/'.length).split('/')
      const ver = rest.shift()
      const file = safePath(join(PACKAGES_DIR, String(ver).replace(/[\\/]/g, '')), rest)
      if (!file || !existsSync(file)) return json(res, 404, { error: 'not found' })
      return serveFile(req, res, file)
    }

    // ── 核心安装包下发 ──
    if (req.method === 'GET' && path.startsWith('/cores/')) {
      const rest = path.slice('/cores/'.length).split('/')
      const ver = rest.shift()
      const file = safePath(join(CORES_DIR, String(ver).replace(/[\\/]/g, '')), rest)
      if (!file || !existsSync(file)) return json(res, 404, { error: 'not found' })
      return serveFile(req, res, file)
    }

    // ── 玩家云存档 ──
    if (path === '/api/player/data') {
      const auth = authUser(req)
      if (!auth) return json(res, 401, { error: '未登录或凭据无效' })
      if (req.method === 'GET') {
        const data = players[auth.name]
        return json(res, 200, { profile: data?.profile ?? null, savedAt: data?.savedAt ?? null })
      }
      if (req.method === 'PUT') {
        const body = (await readBody(req, 2 * 1024 * 1024)) || {}
        if (!body.profile || typeof body.profile !== 'object') {
          return json(res, 400, { error: '缺少存档数据' })
        }
        players[auth.name] = {
          profile: body.profile,
          savedAt: Date.now(),
          clientVersion: body.clientVersion || ''
        }
        saveJSON(PLAYERS_FILE, players)
        return json(res, 200, { ok: true, savedAt: players[auth.name].savedAt })
      }
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) })
  }
})

server.listen(PORT, HOST, () => {
  const versions = currentVersions()
  console.log(`[vp-server] listening on http://${HOST}:${PORT}`)
  console.log(`  数据目录：${DATA_DIR}`)
  console.log(`  已发布资源版本：${Object.keys(versions.resources).sort(compareVersions).join('、') || '（无）'}`)
  console.log(`  已发布核心版本：${Object.keys(versions.cores).sort(compareVersions).join('、') || '（无）'}`)
  console.log(`  API key：${API_KEY ? '已启用' : '未设置（公开模式）'}`)
  console.log('  发布版本/用户管理：node server/admin.mjs')
})
