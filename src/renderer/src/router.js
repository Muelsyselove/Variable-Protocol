// 极简屏幕路由：切换屏幕并维护全局协议常驻栏与标题栏
import { updateProtocolBar } from './ui/components.js'
import { updateTitlebar } from './ui/titlebar.js'
import { updatePetOverlay } from './ui/petOverlay.js'
import { setPetScreen } from './core/petBridge.js'
import { G, protocolName } from './state.js'

const screens = {}
let container = null
let current = null
let currentId = null

export function initRouter(el) {
  container = el
}

export function registerScreen(id, render) {
  screens[id] = render
}

export function show(id, params) {
  if (current?.cleanup) { try { current.cleanup() } catch { /* 忽略 */ } }
  container.innerHTML = ''
  current = { id, cleanup: null }
  currentId = id
  screens[id](container, params)
  // 同步全局协议常驻栏与自定义标题栏
  const pid = G.run?.settings?.protocol || 'none'
  updateProtocolBar(pid === 'none' ? null : pid, protocolName(pid))
  updateTitlebar()
  // 同步全局桌宠浮标状态
  updatePetOverlay(id)
  // 同步桌宠悬浮窗活动文案（内部判断桌宠模式）
  setPetScreen(id)
}

// 当前屏幕注册清理回调（取消动画、销毁渲染器等）
export function onScreenCleanup(fn) {
  if (current) current.cleanup = fn
}

// 当前屏幕id（协议终止时用于刷新非战斗屏幕）
export function currentScreen() {
  return currentId
}
