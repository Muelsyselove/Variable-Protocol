// 更新服务：开屏界面自动检查与下载安装游戏核心更新
// 检查源：个人后台服务器（已配置时，见 backend.js）→ GitHub Releases 兜底
// 下载：session.downloadURL + will-download（原生下载器，支持进度/中断状态），存 <数据目录>/updates/
// 安装：运行安装包（NSIS 向导）并退出应用
import { app, net, shell, session, ipcMain } from 'electron'
import { join } from 'node:path'
import { mkdirSync, rmSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { compareVersions } from './resources.js'

const GITHUB_REPO = 'Muelsyselove/Variable-Protocol'
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// ── GitHub 提供者：最新 release（排除 pre-release）──
async function fetchLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    // net.fetch 走 Chromium 网络栈（系统证书库 + 系统代理）；Node 原生 fetch 不读系统证书，
    // 在装有自定义根 CA（安全软件/代理拦截 TLS）的机器上会证书校验失败，表现为"检查失败"（v1.3.1 教训）
    const res = await net.fetch(GITHUB_LATEST_API, {
      headers: { 'User-Agent': 'Variable-Protocol-Updater', Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (res.status === 404) return { ok: true, latest: null, updateAvailable: false }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}（GitHub API）` }
    const data = await res.json()
    const version = String(data.tag_name || '').replace(/^v/, '')
    // 从资产中找安装包（artifactName 约定 VariableProtocol-Setup-x.y.z.exe）
    const asset = (data.assets || []).find((a) => /^VariableProtocol-Setup-.*\.exe$/i.test(a.name || ''))
    const latest = {
      version,
      name: data.name || '',
      url: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      notes: String(data.body || '').slice(0, 6000),
      publishedAt: data.published_at || '',
      downloadUrl: asset?.browser_download_url || null,
      fileName: asset?.name || null
    }
    return {
      ok: true,
      current: app.getVersion(),
      latest,
      updateAvailable: compareVersions(version, app.getVersion()) > 0
    }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '检查超时（15秒），网络不稳定' : String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

// ── 检查入口：服务器优先（backend 已配置时）→ GitHub 兜底；结果记录到 lastCheck ──
let lastCheck = null       // 最近一次检查结果（含 latest）
let download = null        // { path, received, total, done, failed, item }
let backendProvider = null // 由 index.js 注入（避免主进程模块环）：async () => {ok, latest, updateAvailable} | null
export function setUpdateProvider(fn) { backendProvider = fn }

export async function checkForUpdate() {
  let res
  if (!app.isPackaged) {
    res = { ok: true, dev: true, updateAvailable: false }
  } else {
    res = null
    if (backendProvider) {
      try {
        const r = await backendProvider()
        if (r?.ok && r.latest) res = r
      } catch { /* 服务器检查失败 → GitHub 兜底 */ }
    }
    if (!res) res = await fetchLatestRelease()
  }
  lastCheck = res
  return res
}

// ── 下载：原生下载器 + 进度推送 ──
let progressListener = null

export function setProgressListener(fn) { progressListener = fn }

function pushProgress() {
  if (!download || !progressListener) return
  const percent = download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0
  progressListener({
    received: download.received, total: download.total, percent,
    done: download.done, failed: download.failed, path: download.path
  })
}

export function startUpdateDownload() {
  const url = lastCheck?.latest?.downloadUrl
  if (!url) return { ok: false, error: '该版本未提供自动下载（请前往发布页手动下载）' }
  const dir = join(app.getPath('userData'), 'updates')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, lastCheck.latest.fileName || `VariableProtocol-Setup-${lastCheck.latest.version}.exe`)
  download = { path: target, received: 0, total: 0, done: false, failed: false }
  const ses = session.defaultSession
  const onWillDownload = (event, item) => {
    item.setSavePath(target)
    download.item = item
    download.total = item.getTotalBytes()
    item.on('updated', (_e, state) => {
      if (state === 'interrupted') download.failed = true
      download.received = item.getReceivedBytes()
      pushProgress()
    })
    item.once('done', async (_e, state) => {
      download.done = state === 'completed'
      download.failed = state !== 'completed'
      // 服务器下发的安装包带 sha256：下载完成后校验（GitHub 资产无哈希，跳过）
      if (download.done && lastCheck?.latest?.sha256) {
        try {
          const sha = await sha256File(target)
          if (sha !== lastCheck.latest.sha256) {
            download.done = false
            download.failed = true
          }
        } catch {
          download.done = false
          download.failed = true
        }
      }
      if (download.failed) {
        try { rmSync(target) } catch { /* 清理失败残留 */ }
      }
      pushProgress()
    })
  }
  ses.once('will-download', onWillDownload)
  ses.downloadURL(url)
  return { ok: true }
}

export function getDownloadState() {
  return download ? { ...download } : null
}

// 最近一次检查结果（主窗口红点联动用）
export function getLastCheck() {
  return lastCheck
}

// 流式计算文件 sha256（安装包完整性校验）
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(p)
    s.on('data', (c) => h.update(c))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

// ── 安装：运行安装包并退出 ──
export async function installUpdate() {
  if (!download?.done) return { ok: false, error: '安装包未就绪' }
  await shell.openPath(download.path) // 运行 NSIS 安装向导
  setTimeout(() => app.quit(), 800)
  return { ok: true }
}

// ── IPC 面 ──
export function registerUpdaterIpc() {
  ipcMain.handle('update:check', async () => {
    lastCheck = await checkForUpdate()
    return lastCheck
  })
  ipcMain.handle('update:download', () => startUpdateDownload())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:state', () => getDownloadState())
}
