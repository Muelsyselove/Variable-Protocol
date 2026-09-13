// Electron 主进程：无边框窗口与本地存档
import { app, BrowserWindow, ipcMain, screen, shell, net } from 'electron'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url))

// 打包版：用户数据（存档、缓存、运行时状态）存标准 %APPDATA%（默认 userData，不重定向）。
// v1.1.x 曾重定向到安装目录下 data 文件夹，但 NSIS 升级安装会先卸载旧版并整目录删除，
// 导致升级即清档；%APPDATA% 不受卸载影响，升级可保留存档。
// 旧版本遗留的安装目录存档由两道机制保底：
//   1) installer.nsh 的 customUnInstall 钩子在卸载删除前把 saves 备份到 %APPDATA%（升级场景，此时旧档还在）；
//   2) 此处首启兜底迁移残留的 data\saves（覆盖安装未触发卸载钩子等场景），仅在新位置无存档时迁移。
if (app.isPackaged) {
  try {
    const legacySaves = join(dirname(process.execPath), 'data', 'saves')
    const freshSaves = join(app.getPath('userData'), 'saves')
    if (existsSync(legacySaves) && !existsSync(freshSaves)) {
      cpSync(legacySaves, freshSaves, { recursive: true })
    }
  } catch { /* 迁移失败不影响启动，存档仍可手动找回安装目录 data\saves */ }
}

// 应用图标：窗口/任务栏用 PNG——Electron 将 .ico 路径转换为 HICON 时会损坏 alpha（表现为任务栏空白图标），
// PNG 转换链路无损；.ico 仅由 electron-builder 嵌入 exe（快捷方式/资源管理器显示用）。
// extraResources 已将 icon.png 放到 asar 外的 resources 目录，打包版从 process.resourcesPath 读取。
function appIcon() {
  const base = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  const p = join(base, 'icon.png')
  return existsSync(p) ? p : undefined
}

let win = null
let petWin = null

// Windows 任务栏图标关联：仅打包版设置 AppUserModelId。
// 开发模式下系统没有该 AUMID 的快捷方式图标关联，设置后任务栏反而查不到图标（显示空白）；
// dev 模式不设置，任务栏直接使用 BrowserWindow 的 icon 参数。
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.openclawwork.variable-protocol')
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 460,
    minHeight: 340,
    frame: false, // 自定义边框：标题栏由渲染层绘制
    backgroundColor: '#070b10',
    title: '变量协议 Variable Protocol',
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      // 注意：electron-vite 在 type:module 下输出 ESM preload（.mjs）
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false // 桌宠模式下主窗口隐藏，游戏需继续后台运行
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // pkg=1：打包版标记（渲染层据此提供开局赠礼等发行版专属行为）
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { pkg: '1' } })
  }
  // 二次确保窗口/任务栏图标（Windows 图标缓存有时忽略构造参数）
  const iconPath = appIcon()
  if (iconPath) {
    try { win.setIcon(iconPath) } catch { /* 图标设置失败不影响运行 */ }
  }
}

function savesDir() {
  const d = join(app.getPath('userData'), 'saves')
  mkdirSync(d, { recursive: true })
  return d
}

ipcMain.handle('save:write', (_e, file, data) => {
  writeFileSync(join(savesDir(), file), JSON.stringify(data, null, 2), 'utf-8')
  return true
})

ipcMain.handle('save:read', (_e, file) => {
  try {
    let text = readFileSync(join(savesDir(), file), 'utf-8')
    // 剥离 UTF-8 BOM：外部工具（记事本/PowerShell5.1）写档可能带BOM，否则 JSON.parse 失败误判为无存档
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch {
    return null
  }
})

ipcMain.handle('save:delete', (_e, file) => {
  try { rmSync(join(savesDir(), file)) } catch { /* 忽略不存在 */ }
  return true
})

// 小窗模式：切换窗口尺寸（小窗 460×400 / 常规 1280×840）
ipcMain.handle('window:setMini', (_e, mini) => {
  if (!win) return false
  // 最大化状态（如Aero Snap贴边）下 setSize 无效，先恢复常规状态
  if (win.isMaximized()) win.unmaximize()
  if (mini) {
    win.setSize(460, 400)
  } else {
    win.setAlwaysOnTop(false)
    win.setSize(1280, 840)
  }
  return true
})

// 窗口置顶
ipcMain.handle('window:setAlwaysOnTop', (_e, flag) => {
  if (!win) return false
  win.setAlwaysOnTop(!!flag)
  return true
})

// 窗口控制：最小化 / 关闭
ipcMain.handle('window:minimize', () => {
  win?.minimize()
  return true
})

ipcMain.handle('window:close', () => {
  win?.close()
  return true
})

// ══════════ 桌宠悬浮窗（透明无边框独立窗口） ══════════
// 打开：隐藏主窗口（游戏后台继续），在屏幕右下角创建透明桌宠窗
ipcMain.handle('pet:open', () => {
  if (petWin) { petWin.show(); return true }
  const wa = screen.getPrimaryDisplay().workArea
  petWin = new BrowserWindow({
    width: 360,
    height: 560,
    x: wa.x + wa.width - 392,
    y: wa.y + wa.height - 595,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  petWin.setAlwaysOnTop(true, 'screen-saver')
  if (process.env.ELECTRON_RENDERER_URL) {
    petWin.loadURL(process.env.ELECTRON_RENDERER_URL + '?pet=1')
  } else {
    petWin.loadFile(join(__dirname, '../renderer/index.html'), { query: { pet: '1', pkg: '1' } })
  }
  petWin.on('closed', () => {
    petWin = null
    stopPetDrag()
    // 意外关闭（如Alt+F4）：恢复主窗口并通知渲染层退出桌宠模式
    if (win && !win.isVisible()) {
      win.show()
      win.webContents.send('pet:action', { type: 'exit' })
    }
  })
  win?.hide()
  return true
})

// 关闭：销毁桌宠窗并恢复主窗口
ipcMain.handle('pet:close', () => {
  if (petWin) petWin.close()
  if (win && !win.isVisible()) {
    win.show()
    win.focus()
  }
  return true
})

// 主窗口 → 桌宠窗：状态推送
ipcMain.handle('pet:push', (_e, data) => {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:state', data)
  return !!petWin
})

// 桌宠窗 → 主窗口：动作转发
ipcMain.handle('pet:action', (_e, action) => {
  if (win && !win.isDestroyed()) win.webContents.send('pet:action', action)
  return true
})

// ── 拖动：主进程光标轮询驱动 ──
// 渲染层 mousemove + setPosition 组合在窗口移动后会产生坐标漂移的伪事件（表现为按住不动时窗口持续滑动），
// 改由主进程每帧读取全局光标位置移动窗口，彻底规避
let petDragOffset = null
let petDragTimer = null

function stopPetDrag() {
  petDragOffset = null
  if (petDragTimer) { clearInterval(petDragTimer); petDragTimer = null }
}

ipcMain.handle('pet:dragStart', () => {
  if (!petWin) return false
  const c = screen.getCursorScreenPoint()
  const b = petWin.getBounds()
  petDragOffset = { dx: c.x - b.x, dy: c.y - b.y }
  if (!petDragTimer) {
    petDragTimer = setInterval(() => {
      if (!petDragOffset || !petWin) return
      const c = screen.getCursorScreenPoint()
      petWin.setPosition(c.x - petDragOffset.dx, c.y - petDragOffset.dy)
    }, 16)
  }
  return true
})

ipcMain.handle('pet:dragEnd', () => {
  stopPetDrag()
  return true
})

// ── 点击穿透：透明区域放行鼠标（forward 保持悬停检测以恢复交互） ──
ipcMain.handle('pet:setIgnore', (_e, flag) => {
  if (petWin && !petWin.isDestroyed()) petWin.setIgnoreMouseEvents(!!flag, { forward: true })
  return true
})

// 端点规范化：兼容用户填写 Base URL（自动补全 /chat/completions 路径）
// 支持：完整路径 / Base URL（…/v1、…/v4、…/api/paas/v4 等）/ 裸域名（补 /v1/chat/completions）
function resolveEndpoint(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (/\/chat\/completions$/.test(url)) return url
  if (/\/v\d+[a-z]*$/i.test(url)) return url + '/chat/completions'
  if (/\/completions$/.test(url)) return url.replace(/\/completions$/, '/chat/completions')
  return url + '/v1/chat/completions'
}

// AI 对话代理：转发 OpenAI 兼容 chat/completions 请求（主进程绕开渲染层跨域限制）
ipcMain.handle('ai:chat', async (_e, { endpoint, apiKey, model, messages, temperature }) => {
  try {
    const url = resolveEndpoint(endpoint)
    if (!url) return { ok: false, error: '接口地址为空' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.3 }),
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}（请求 ${url}）${text.slice(0, 200)}` }
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? ''
    if (!content) return { ok: false, error: `AI返回内容为空（请求 ${url}）` }
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '请求超时（60秒）' : String(err?.message || err) }
  }
})

// ── 应用内更新检查（GitHub Releases） ──
// 检查最新 release（GitHub releases/latest 自动排除 pre-release），与当前版本比较；
// 不自动下载安装，仅在设置页展示更新信息并引导前往发布页手动下载。
const GITHUB_REPO = 'Muelsyselove/Variable-Protocol'
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// 版本号比较：按数值段逐位比较（v1.10.0 > v1.9.0），非数字段按 0 处理
function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/)
  const pb = String(b).split(/[.\-+]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0
    const nb = parseInt(pb[i], 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

async function fetchLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    // net.fetch 走 Chromium 网络栈（系统证书库 + 系统代理）；Node 原生 fetch 不读系统证书，
    // 在装有自定义根 CA（安全软件/代理拦截 TLS）的机器上会证书校验失败，表现为"检查失败"
    const res = await net.fetch(GITHUB_LATEST_API, {
      headers: { 'User-Agent': 'Variable-Protocol-Updater', Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (res.status === 404) return { ok: true, current: app.getVersion(), latest: null, updateAvailable: false }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}（GitHub API）` }
    const data = await res.json()
    const latest = {
      version: String(data.tag_name || '').replace(/^v/, ''),
      name: data.name || '',
      url: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      notes: String(data.body || '').slice(0, 6000),
      publishedAt: data.published_at || ''
    }
    return {
      ok: true,
      current: app.getVersion(),
      latest,
      updateAvailable: compareVersions(latest.version, app.getVersion()) > 0
    }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '检查超时（15秒），网络不稳定' : String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('update:check', () => fetchLatestRelease())

ipcMain.handle('update:openRelease', async () => {
  await shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`)
  return true
})

// 启动静默检查：仅打包版，延迟 30 秒避开启动高峰；发现新版本时推送渲染层（菜单设置入口红点）
app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged) {
    setTimeout(async () => {
      const res = await fetchLatestRelease()
      if (res?.ok && res.updateAvailable && win && !win.isDestroyed()) {
        win.webContents.send('update:found', res)
      }
    }, 30000)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
