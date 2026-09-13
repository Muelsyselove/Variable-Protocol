// 桌宠悬浮窗渲染（独立透明窗口）：仅桌宠立绘 + 消息气泡 + 右键菜单
// 交互设计：
//  - 像素级点击穿透：透明区域鼠标事件放行到底层窗口（alpha 命中检测 + setIgnoreMouseEvents）
//  - 左键点击=傲娇互动；左键按住=拖动（主进程光标轮询驱动，防坐标漂移）
//  - 右键=操作菜单（饱食度/好感度/静音/倍速/跳过动画/口粮/喂食/协议/桌宠/返回大屏）
import { el } from './components.js'

let state = null
let menuEl = null
let ignoring = true
let dragging = false
let downPos = null
let quoteTimer = null

// 命中检测画布：按立绘像素 alpha 判断鼠标是否在桌宠上
const hitCanvas = document.createElement('canvas')
const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true })

export function bootPet() {
  document.documentElement.classList.add('pet-win')
  document.title = '桌宠'

  const root = el(`
  <div class="pw-root">
    <div class="pw-bubble" id="pw-bubble">连接中…</div>
    <img class="pw-img" id="pw-img" alt="桌宠" draggable="false"/>
  </div>`)
  document.body.appendChild(root)

  const img = root.querySelector('#pw-img')
  const bubble = root.querySelector('#pw-bubble')

  // ── 状态接收 ──
  window.api.onPetState((s) => {
    state = s
    if (s.img && !img.src.endsWith(s.img)) {
      img.src = s.img
      updateHitImage(s.img)
    }
    img.title = s.petName ? `${s.petName} · ${s.stateName}` : '桌宠'
    if (s.quote) {
      bubble.textContent = s.quote
      if (quoteTimer) clearTimeout(quoteTimer)
      quoteTimer = setTimeout(() => { bubble.textContent = state?.activity || '' }, 3000)
    } else {
      bubble.textContent = s.activity
    }
    // 菜单打开期间：随新状态刷新内容（保持位置与滚动，支持连续操作）
    if (menuEl) refreshMenu()
  })
  // 启动同步：向主窗口请求一次状态
  window.api.petAction({ type: 'sync' })

  // ── 像素级点击穿透 ──
  // 悬停检测：mouse 在桌宠像素上→恢复交互；在透明区/气泡→放行鼠标
  document.addEventListener('mousemove', (e) => {
    updateIgnore(e.clientX, e.clientY)
  }, true)

  // ── 拖动与点击（主进程驱动，规避渲染层伪 mousemove 坐标漂移） ──
  img.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    downPos = { x: e.screenX, y: e.screenY }
    dragging = true
    setIgnore(false)
    window.api.petDragStart()
  })
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return
    dragging = false
    window.api.petDragEnd()
    // 位移极小视为点击：傲娇互动
    if (downPos && Math.hypot(e.screenX - downPos.x, e.screenY - downPos.y) < 6) {
      window.api.petAction({ type: 'interact' })
    }
    downPos = null
    updateIgnore(e.clientX, e.clientY)
  })
  window.addEventListener('blur', () => {
    if (dragging) { dragging = false; window.api.petDragEnd() }
    closeMenu()
    setIgnore(true)
  })

  // ── 右键菜单 ──
  img.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openMenu(e.clientX, e.clientY)
  })
  window.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu()
  })

  // 初始全窗穿透，等待鼠标掠过桌宠像素时恢复交互
  setIgnore(true)
}

// ── 穿透开关 ──
function setIgnore(v) {
  if (v === ignoring) return
  ignoring = v
  window.api.petSetIgnore(v)
}
function updateIgnore(x, y) {
  const interactive = !!(menuEl) || dragging || isOnPet(x, y)
  setIgnore(!interactive)
}

// ── 命中检测：客户端坐标 → 立绘画布坐标 → alpha ──
function updateHitImage(src) {
  const im = new Image()
  im.onload = () => {
    hitCanvas.width = im.naturalWidth
    hitCanvas.height = im.naturalHeight
    hitCtx.clearRect(0, 0, hitCanvas.width, hitCanvas.height)
    hitCtx.drawImage(im, 0, 0)
  }
  im.src = src
}
function isOnPet(x, y) {
  const img = document.getElementById('pw-img')
  if (!img || !hitCanvas.width) return false
  const r = img.getBoundingClientRect()
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false
  const px = Math.floor(((x - r.left) / r.width) * hitCanvas.width)
  const py = Math.floor(((y - r.top) / r.height) * hitCanvas.height)
  if (px < 0 || py < 0 || px >= hitCanvas.width || py >= hitCanvas.height) return false
  try {
    return hitCtx.getImageData(px, py, 1, 1).data[3] > 16
  } catch {
    return false
  }
}

// ── 右键菜单（扁平布局：所有项直接可见，超高时内部滚动） ──
// 连续操作：除「返回大屏」外，动作执行后菜单保持打开，
// 主窗口推送新状态（口粮库存/饱食度/算力币等）时刷新菜单数值
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null }
}

function openMenu(x, y) {
  closeMenu()
  menuEl = el('<div class="pw-menu"></div>')
  document.body.appendChild(menuEl)
  renderMenuContent()
  clampMenu(x, y)
}

// 状态推送后刷新菜单（保持位置与滚动位置）
function refreshMenu() {
  if (!menuEl) return
  const st = menuEl.scrollTop
  renderMenuContent()
  menuEl.scrollTop = st
}

function renderMenuContent() {
  const s = state || {}
  const pets = (s.pets || []).filter((p) => p.owned)
  const protos = s.protocols || []
  const snd = s.sound !== false

  const rows = [
    `<div class="pw-mi pw-static">算力币<span class="pw-val">⌾ ${s.coins ?? 0}</span></div>`,
    `<div class="pw-mi-sep"></div>`,
    `<div class="pw-mi" data-a="viewSat">查看饱食度<span class="pw-val">${s.satiety ?? 0}/100</span></div>`,
    `<div class="pw-mi" data-a="viewAff">查看好感度<span class="pw-val">${s.affection ?? 0}/100</span></div>`,
    `<div class="pw-mi-sep"></div>`,
    `<div class="pw-mi" data-a="toggleSound">${snd ? '静音' : '开启音效'}<span class="pw-val">${snd ? '♪ 开' : '✕ 关'}</span></div>`,
    `<div class="pw-mi" data-a="cycleSpeed">战斗倍速<span class="pw-val">×${s.speed || 1}</span></div>`,
    `<div class="pw-mi" data-a="toggleAnim">跳过动画<span class="pw-val">${s.animSkip ? '开' : '关'}</span></div>`,
    `<div class="pw-mi" data-a="toggleChain">连战<span class="pw-val">${s.chainBattle ? '开' : '关'}</span></div>`,
    `<div class="pw-mi-sep"></div>`,
    `<div class="pw-mi" data-a="buyFood">购买口粮<span class="pw-val">${s.foodPrice ?? 25}币</span></div>`,
    `<div class="pw-mi" data-a="feed">喂食<span class="pw-val">库存 ${s.food ?? 0}</span></div>`,
    `<div class="pw-mi-sep"></div>`,
    `<div class="pw-mi-header">自动协议</div>`,
    ...protos.map((p) => `<div class="pw-mi" data-a="setProtocol" data-id="${p.id}">${p.active ? '<span class="pw-cur">●</span>' : ''}${p.name}</div>`),
    `<div class="pw-mi-header">更换桌宠</div>`,
    ...(pets.length
      ? pets.map((p) => `<div class="pw-mi" data-a="setPet" data-id="${p.id}">${p.active ? '<span class="pw-cur">●</span>' : ''}${p.name}</div>`)
      : ['<div class="pw-mi pw-disabled">（尚无桌宠）</div>']),
    `<div class="pw-mi-sep"></div>`,
    `<div class="pw-mi pw-danger" data-a="exit">返回大屏模式</div>`
  ]
  menuEl.innerHTML = rows.join('')

  menuEl.querySelectorAll('.pw-mi[data-a]').forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation()
      const a = { type: item.dataset.a }
      if (item.dataset.id) a.id = item.dataset.id
      window.api.petAction(a)
      if (a.type === 'exit') {
        closeMenu()
        setIgnore(true)
      }
      // 其余动作不关闭菜单：等待主窗口推送新状态后由 refreshMenu 更新数值
    }
  })
}

// 菜单定位：钳制在窗口内，超高时收缩高度并内部滚动
function clampMenu(x, y) {
  const W = window.innerWidth
  const H = window.innerHeight
  menuEl.style.maxHeight = (H - 8) + 'px'
  const mw = menuEl.offsetWidth
  const mh = menuEl.offsetHeight
  menuEl.style.left = Math.max(4, Math.min(W - mw - 4, x)) + 'px'
  menuEl.style.top = Math.max(4, Math.min(H - mh - 4, y)) + 'px'
}
