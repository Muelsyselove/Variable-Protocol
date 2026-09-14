// 本地 mock 后端服务器（开发工具，不入版本记录）：联调用占位服务器
// 实现与客户端 backend.js 约定的接口：登录 / 核心更新查询 / 资源更新（逐文件）/ 云存档
// 用法：node scripts/mock-server.mjs
// 环境变量：
//   PORT=8787               监听端口
//   MOCK_RES_VERSION=2.0.1  模拟的资源包版本（高于客户端当前资源版本即会触发更新）
//   MOCK_RES_ROOT=<dir>     模拟资源包目录（默认仓库 resources/game）
//   MOCK_CORE_VERSION=0.0.0 模拟的最新核心版本（0.0.0 = 无核心更新）
// 客户端接入：复制 server.example.json 为 %APPDATA%\variable-protocol\server.json 并填 http://127.0.0.1:8787
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 8787)
const MOCK_RES_VERSION = process.env.MOCK_RES_VERSION || '2.0.1'
const MOCK_CORE_VERSION = process.env.MOCK_CORE_VERSION || '0.0.0'
const ROOT = process.env.MOCK_RES_ROOT
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'game')

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.txt': 'text/plain'
}

// 资源清单：直接复用资源包 manifest.json 的文件列表与哈希（首次访问时缓存）
let fileIndex = null
function buildIndex() {
  if (fileIndex) return fileIndex
  const manifestPath = join(ROOT, 'manifest.json')
  let files = {}
  if (existsSync(manifestPath)) {
    files = JSON.parse(readFileSync(manifestPath, 'utf-8')).files || {}
  } else {
    console.warn('[mock] 资源目录缺少 manifest.json（先运行 scripts/gen-resource-manifest.mjs）')
  }
  fileIndex = files
  return files
}

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.\-+]/), pb = String(b || '0').split(/[.\-+]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

// 云存档（内存态，重启清空；按用户名隔离）
const cloudStore = new Map()

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c })
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')) } catch { resolve({}) }
    })
  })
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = u.pathname

  try {
    // ── 登录 / 注册（mock：接受任意账密） ──
    if (req.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/register')) {
      const { username, password } = await readBody(req)
      if (!username || !password) return json(res, 400, { error: '用户名与密码不能为空' })
      return json(res, 200, { ok: true, token: 'mock-token', username })
    }

    // ── 核心更新 ──
    if (req.method === 'GET' && path === '/api/core/latest') {
      const core = u.searchParams.get('core') || '0'
      return json(res, 200, {
        version: MOCK_CORE_VERSION,
        name: MOCK_CORE_VERSION === '0.0.0' ? '' : 'mock 核心更新',
        notes: '这是本地 mock 服务器模拟的核心版本，用于联调更新检查流程。',
        url: 'https://github.com/Muelsyselove/Variable-Protocol/releases/latest',
        downloadUrl: null, // mock 不提供安装包下载；客户端会回落"前往发布页"
        publishedAt: new Date().toISOString(),
        _noUpdate: compareVersions(MOCK_CORE_VERSION, core) <= 0
      })
    }

    // ── 资源更新（v2 增量协议：mock 仅持有单一版本，恒为全量 changed；无更新时返回空） ──
    if (req.method === 'GET' && path === '/api/resources/latest') {
      const resource = u.searchParams.get('resource') || '0'
      const files = buildIndex()
      if (compareVersions(MOCK_RES_VERSION, resource) <= 0) {
        return json(res, 200, { ok: true, update: null })
      }
      const changed = {}
      for (const [rel, sha256] of Object.entries(files)) {
        changed[rel] = { url: `/packages/${rel}`, sha256 }
      }
      return json(res, 200, { ok: true, version: MOCK_RES_VERSION, minCore: '2.0.0', manifest: files, changed, removes: [] })
    }

    // ── 资源文件下发 ──
    if (req.method === 'GET' && path.startsWith('/packages/')) {
      const rel = decodeURIComponent(path.slice('/packages/'.length)).replaceAll('\\', '/')
      const file = join(ROOT, ...rel.split('/'))
      if (!file.startsWith(ROOT.replaceAll('\\', '/')) && !file.startsWith(ROOT)) {
        return json(res, 403, { error: 'forbidden' })
      }
      if (!existsSync(file)) return json(res, 404, { error: 'not found' })
      const buf = readFileSync(file)
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      })
      return res.end(buf)
    }

    // ── 云存档 ──
    if (path === '/api/player/data') {
      const auth = req.headers.authorization || ''
      const token = auth.replace(/^Bearer\s+/i, '')
      if (token !== 'mock-token') return json(res, 401, { error: '未登录或凭据无效' })
      // 从 token 反查用户名不可行（mock 无状态），用 header 里客户端未传——按单用户 mock 处理
      const user = 'mock-user'
      if (req.method === 'GET') {
        const data = cloudStore.get(user)
        return data ? json(res, 200, { profile: data }) : json(res, 200, { profile: null })
      }
      if (req.method === 'PUT') {
        const body = await readBody(req)
        cloudStore.set(user, body.profile || null)
        return json(res, 200, { ok: true, savedAt: Date.now() })
      }
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-server] http://127.0.0.1:${PORT}`)
  console.log(`  资源版本模拟：v${MOCK_RES_VERSION}（目录 ${ROOT}）`)
  console.log(`  核心版本模拟：v${MOCK_CORE_VERSION}（0.0.0 = 无更新）`)
  console.log('  任意用户名/密码可登录；云存档为内存态（重启清空）')
})
