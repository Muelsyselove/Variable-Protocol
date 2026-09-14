// 资源服务：游戏资源包（数据+图片）与游戏核心（asar 内代码）分离的外部化基础设施
// 职责：资源根解析（基线/覆盖层）、清单读取与快速校验、图片映射扫描、game:// 自定义协议
// 资源包结构：
//   <资源根>/manifest.json        {format, version, minCore, files:{相对路径:sha256}}
//   <资源根>/data/*.json          转译器/骰子/敌人/干员/武器/事件/桌宠定义
//   <资源根>/images/{characters,weapons,translators,pets/...}
// 根解析优先级（打包版）：数据目录覆盖层（服务器资源更新）→ 安装目录基线（随安装包发布）
import { app, protocol, ipcMain, net } from 'electron'
import { join, resolve, normalize, dirname } from 'node:path'
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url))

// game:// 协议必须在 app ready 之前注册为特权协议（standard 支持 fetch/img 加载）
export function registerGameScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'game',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

// ── 版本比较：按数值段逐位比较（v1.10.0 > v1.9.0），非数字段按 0 处理 ──
export function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.\-+]/)
  const pb = String(b || '0').split(/[.\-+]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0
    const nb = parseInt(pb[i], 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

// ── 资源根路径 ──
// 覆盖层：数据目录下的服务器资源更新（供 backend.js 增量同步与修复使用）
export function overlayResourceRoot() {
  return join(app.getPath('userData'), 'resources', 'game')
}

// 基线：安装包随附资源（打包版在 asar 外 resources 目录；开发模式为仓库内资源目录）
export function baseResourceRoot() {
  return app.isPackaged ? join(process.resourcesPath, 'game') : join(__dirname, '../../resources/game')
}

// ── 资源根候选（优先级从高到低）──
function resourceRoots() {
  if (app.isPackaged) {
    return [
      { kind: 'overlay', path: overlayResourceRoot() },
      { kind: 'base', path: baseResourceRoot() }
    ]
  }
  // 开发模式：直接使用仓库内资源目录（改 JSON 免重新构建即生效）
  return [{ kind: 'base', path: baseResourceRoot() }]
}

// 读取某根的 manifest（不存在/损坏返回 null）
function readManifestAt(root) {
  try {
    let text = readFileSync(join(root, 'manifest.json'), 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // 剥离 BOM
    const m = JSON.parse(text)
    return m && typeof m === 'object' && m.version ? m : null
  } catch {
    return null
  }
}

// 启动快速校验：清单所列文件全部存在（sha256 校验仅在资源更新安装/修复时执行，避免每次启动全量哈希）
function quickVerifyAt(root, manifest) {
  if (!manifest) return false
  try {
    for (const p of Object.keys(manifest.files || { 'data/pets.json': 1 })) {
      if (!existsSync(join(root, p))) return false
    }
    return true
  } catch {
    return false
  }
}

// 活动资源根：覆盖层版本更高且校验通过时用覆盖层，否则回退基线
let activeRoot = null
let activeInfo = null

export function resolveActiveRoot() {
  const roots = resourceRoots()
  const overlay = roots.find((r) => r.kind === 'overlay')
  const base = roots.find((r) => r.kind === 'base')
  const overlayManifest = overlay ? readManifestAt(overlay.path) : null
  const baseManifest = base ? readManifestAt(base.path) : null
  const overlayVer = overlayManifest?.version || '0'
  const baseVer = baseManifest?.version || '0'

  let chosen = null
  let ignoredDowngrade = false
  if (overlay && overlayManifest) {
    if (compareVersions(overlayVer, baseVer) > 0) {
      if (quickVerifyAt(overlay.path, overlayManifest)) chosen = { ...overlay, manifest: overlayManifest }
      else ignoredDowngrade = true // 覆盖层损坏 → 弃用回退基线，不删除用户目录内容
    } else {
      ignoredDowngrade = true // 覆盖层版本不高于基线 → 弃用（保留磁盘内容，仅不生效）
    }
  }
  if (!chosen && base && quickVerifyAt(base.path, baseManifest)) {
    chosen = { ...base, manifest: baseManifest }
  }
  if (!chosen && base) {
    // 基线清单缺失但目录存在（开发中手改）：尽力使用
    chosen = { ...base, manifest: baseManifest || { format: 1, version: '0.0.0', files: {} } }
  }
  activeRoot = chosen
  activeInfo = {
    ok: !!chosen,
    version: chosen?.manifest?.version || null,
    source: chosen?.kind || null,
    roots: { overlay: overlay?.path || null, base: base?.path || null },
    ignoredDowngrade
  }
  return chosen
}

export function resourceInfo() {
  return { ...activeInfo }
}

// ── 图片映射：扫描三类「文件名=id」目录 ──
// 桌宠图片路径由 pets.json 显式声明（状态名→相对路径），此处不扫描
function scanImageMap(root) {
  const map = { characters: {}, weapons: {}, translators: {} }
  if (!root) return map
  for (const cat of Object.keys(map)) {
    const dir = join(root, 'images', cat)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (/\.(png|jpe?g|webp)$/i.test(f)) {
        map[cat][f.replace(/\.(png|jpe?g|webp)$/i, '')] = `game://images/${cat}/${f}`
      }
    }
  }
  return map
}

let imageMap = null
export function getImageMap() {
  if (!imageMap) imageMap = scanImageMap(activeRoot?.path)
  return imageMap
}

// ── game:// 协议处理器：game://<一级目录>/<其余路径> → 活动资源根下同名文件 ──
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.txt': 'text/plain',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
}

function extOf(p) {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i).toLowerCase() : ''
}

export function registerGameProtocol() {
  protocol.handle('game', async (req) => {
    try {
      const u = new URL(req.url)
      // standard 协议下 <scheme>://<host>/<path>：host 即一级目录
      const rel = decodeURIComponent(u.hostname + u.pathname)
      const root = activeRoot?.path
      if (!root) return new Response(null, { status: 503 })
      const file = normalize(join(root, rel))
      // 路径穿越防护
      if (!file.startsWith(resolve(root))) return new Response(null, { status: 403 })
      if (!existsSync(file)) return new Response(null, { status: 404 })
      const mime = MIME[extOf(file)] || 'application/octet-stream'
      const res = await net.fetch(pathToFileURL(file).toString())
      // 统一补 CORS 头：渲染层（file:// 或 dev http:// 源）fetch game:// 需要跨域许可
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' }
      })
    } catch {
      return new Response(null, { status: 500 })
    }
  })
}

// ── 资源修复：删除数据目录覆盖层，回退安装基线（磁盘内容移入回收站不可行，直接删除 overlay 目录）──
export function repairResources() {
  const overlay = resourceRoots().find((r) => r.kind === 'overlay')
  if (overlay && existsSync(overlay.path)) {
    try { rmSync(dirname(overlay.path), { recursive: true, force: true }) } catch { /* 删除失败不影响回退判定 */ }
  }
  imageMap = null
  resolveActiveRoot()
  return resourceInfo()
}

// ── IPC 面 ──
export function registerResourceIpc() {
  ipcMain.handle('res:info', () => resourceInfo())
  ipcMain.handle('res:imageMap', () => getImageMap())
  ipcMain.handle('res:repair', () => repairResources())
}

// 初始化（app ready 后、创建窗口前调用）
export function initResources() {
  resolveActiveRoot()
  registerGameProtocol()
  registerResourceIpc()
  return resourceInfo()
}
