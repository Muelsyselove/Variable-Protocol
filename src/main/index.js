// Electron 主进程：无边框窗口与本地存档
import { app, BrowserWindow, ipcMain, screen, shell, dialog } from 'electron'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerGameScheme, initResources } from './resources.js'
import { registerUpdaterIpc, setProgressListener, setUpdateProvider } from './updater.js'
import { registerBackendIpc, backendConfigured, checkCoreUpdate, setResourceApplyListener, pushPlayerData, accountState } from './backend.js'

const __dirname = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url))

// game:// 特权协议注册必须先于 app ready（资源包加载通道）
registerGameScheme()

// ══════════ 数据目录重定向（须先于一切窗口/存档访问执行） ══════════
// 自定义数据目录记录在默认 userData 下的指针文件（datapath.json）中，启动时最先读取并 setPath。
// 安全省则（源自 v1.1.x 清档事故：数据存安装目录，NSIS 升级整目录删除）：
//   1) 拒绝指向安装目录内的任何位置；
//   2) 切换目录只复制迁移 saves，原位置保留为备份，任何路径上都不删除用户数据。
const defaultUserData = app.getPath('userData')
let dataDirOverride = null
let dataDirFallbackNotice = null

function pointerFile() {
  return join(defaultUserData, 'datapath.json')
}

// 是否位于安装目录内（安装目录 = 可执行文件所在目录）
function isInsideInstallDir(dir) {
  const rel = relative(resolve(dirname(process.execPath)), resolve(dir))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// 校验候选数据目录：不在安装目录内、可创建、可读写
function isValidDataDir(dir) {
  if (isInsideInstallDir(dir)) return false
  try {
    mkdirSync(join(dir, 'saves'), { recursive: true })
    const probe = join(dir, '.vp-write-test')
    writeFileSync(probe, 'ok', 'utf-8')
    rmSync(probe)
    return true
  } catch {
    return false
  }
}

function readPointer() {
  try {
    let text = readFileSync(pointerFile(), 'utf-8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // 剥离 BOM
    const dir = JSON.parse(text)?.dir
    return typeof dir === 'string' && dir.trim() ? dir.trim() : null
  } catch {
    return null // 指针不存在/损坏 = 使用默认位置
  }
}

{
  const want = readPointer()
  if (want) {
    if (isValidDataDir(want)) {
      dataDirOverride = want
      app.setPath('userData', want)
    } else {
      dataDirFallbackNotice = want // 目录失效（换盘/被删），回退默认，就绪后提示
    }
  }
}

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
  // 开发模式：渲染层报错/警告转发到主进程 stdout，便于 npm run dev 排查
  if (process.env.ELECTRON_RENDERER_URL) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level >= 3 ? 'error' : 'warn'}] ${message}`)
    })
  }
  // 最大化状态变化（含 Aero Snap 拖拽贴边、标题栏双击等外部触发）：推送渲染层同步按钮图标
  const pushMaximized = (v) => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized', v)
  }
  win.on('maximize', () => pushMaximized(true))
  win.on('unmaximize', () => pushMaximized(false))
}

function savesDir() {
  const d = join(app.getPath('userData'), 'saves')
  mkdirSync(d, { recursive: true })
  return d
}

// 存档文件白名单：玩家数据仅允许这两个文件（profile=玩家档案 / run=进行中对局），
// 防止任意路径写入；账号、服务器配置等其他数据各有独立存储（accountStore/backend）
const SAVE_FILES = new Set(['profile.json', 'run.json'])

ipcMain.handle('save:write', (_e, file, data) => {
  if (!SAVE_FILES.has(file)) return false
  writeFileSync(join(savesDir(), file), JSON.stringify(data, null, 2), 'utf-8')
  return true
})

ipcMain.handle('save:read', (_e, file) => {
  if (!SAVE_FILES.has(file)) return null
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
  if (!SAVE_FILES.has(file)) return false
  try { rmSync(join(savesDir(), file)) } catch { /* 忽略不存在 */ }
  return true
})

// ── 数据目录：查询 / 更改 / 恢复默认 ──
function dataDirState() {
  const current = app.getPath('userData')
  return { current, isDefault: resolve(current) === resolve(defaultUserData), default: defaultUserData }
}

// 把当前 saves 复制到目标目录（不删源，原位置保留为备份）
function migrateSavesTo(dir) {
  const src = join(app.getPath('userData'), 'saves')
  if (existsSync(src)) cpSync(src, join(dir, 'saves'), { recursive: true })
}

function applyDataDir(rawDir) {
  const raw = String(rawDir || '').trim()
  if (!raw) return { ok: false, error: '路径为空' }
  const target = resolve(raw)
  const current = resolve(app.getPath('userData'))
  if (target.toLowerCase() === current.toLowerCase()) return { ok: false, error: '该目录已是当前数据目录' }
  if (isInsideInstallDir(target)) {
    return { ok: false, error: '不能选择安装目录内的位置：升级/卸载会整目录删除该位置的数据' }
  }
  if (!isValidDataDir(target)) return { ok: false, error: '目录无法创建或不可写' }
  try {
    migrateSavesTo(target)
  } catch (err) {
    return { ok: false, error: '存档迁移失败：' + (err?.message || err) }
  }
  if (target.toLowerCase() === resolve(defaultUserData).toLowerCase()) {
    try { rmSync(pointerFile()) } catch { /* 指针不存在则忽略 */ }
    dataDirOverride = null
  } else {
    try {
      writeFileSync(pointerFile(), JSON.stringify({ dir: target }, null, 2), 'utf-8')
    } catch (err) {
      return { ok: false, error: '写入指针文件失败：' + (err?.message || err) }
    }
    dataDirOverride = target
  }
  app.setPath('userData', dataDirOverride || defaultUserData)
  return { ok: true, ...dataDirState() }
}

ipcMain.handle('data:getDir', () => dataDirState())

ipcMain.handle('data:chooseDir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择数据目录（存档保存位置）',
    defaultPath: app.getPath('userData'),
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
  return applyDataDir(res.filePaths[0])
})

ipcMain.handle('data:resetDir', () => {
  if (!dataDirOverride) return { ok: false, error: '已是默认位置' }
  return applyDataDir(defaultUserData)
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

// 最大化 / 还原切换（返回当前是否最大化，供按钮图标同步）
ipcMain.handle('window:toggleMaximize', () => {
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
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

// ── 应用内更新（检查/下载/安装在 src/main/updater.js；开屏覆盖层在主窗口内，由渲染层驱动检查）──
const GITHUB_REPO = 'Muelsyselove/Variable-Protocol'

ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('update:openRelease', async () => {
  await shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`)
  return true
})

// ══════════ 启动编排：主窗口（内含开屏覆盖层） ══════════
app.whenReady().then(async () => {
  // 资源服务初始化：解析活动资源根（基线/覆盖层）并注册 game:// 协议处理器，须先于窗口创建
  initResources()
  registerUpdaterIpc()
  registerBackendIpc()
  // 更新检查提供者：服务器优先（已配置时），GitHub Releases 兜底
  if (backendConfigured()) setUpdateProvider(() => checkCoreUpdate())
  // 下载进度 / 资源应用进度推送主窗口（开屏覆盖层在主窗口内）
  const sendWin = (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data)
  }
  setProgressListener((p) => sendWin('update:downloadProgress', p))
  setResourceApplyListener((p) => sendWin('resource:applyProgress', p))

  createWindow()

  // 自定义数据目录失效（换盘/被删）：已回退默认位置，弹窗告知避免"存档消失"困惑
  if (dataDirFallbackNotice) {
    dialog.showMessageBox(win, {
      type: 'warning',
      title: '数据目录不可用',
      message: `自定义数据目录不可用：\n${dataDirFallbackNotice}\n\n已回退到默认位置：${defaultUserData}\n可在「系统设置 → 数据目录」重新指定。`,
      buttons: ['知道了']
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── 退出自动云同步：已登录且服务器可用时，退出前把本地玩家档案上传云端（v2.1.0）──
// 只尝试一次且限时 8 秒（无论成败不阻碍退出）；离线/未登录直接退出。
let quitSyncDone = false
app.on('before-quit', (e) => {
  if (quitSyncDone) return
  quitSyncDone = true
  const acc = accountState()
  if (!acc.configured || !acc.loggedIn) return
  e.preventDefault()
  const guard = new Promise((resolve) => setTimeout(resolve, 8000))
  Promise.race([pushPlayerData(), guard]).catch(() => {}).finally(() => app.quit())
})
