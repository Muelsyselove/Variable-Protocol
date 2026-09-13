// 全局桌宠浮标：屏幕右下角常驻Q版桌宠，按状态机实时换图
// menu 屏隐藏（主菜单有专属大展示位）；点击触发傲娇状态与台词气泡
import { G } from '../state.js'
import { activePet, chibiFor, computePetState, setPetFlash, petQuote, PET_STATE_NAMES } from '../data/pets.js'
import { el } from './components.js'

let overlayEl = null
let bubbleTimer = null
let lastState = null

export function ensurePetOverlay() {
  if (overlayEl) return overlayEl
  overlayEl = el(`
  <div id="pet-overlay" class="pet-overlay" style="display:none" title="桌宠">
    <div class="pet-overlay-bubble" id="pet-overlay-bubble"></div>
    <img class="pet-overlay-img" id="pet-overlay-img" alt="桌宠"/>
  </div>`)
  document.body.appendChild(overlayEl)
  overlayEl.onclick = () => {
    const pet = activePet(G.profile)
    if (!pet) return
    setPetFlash('tsundere', 3000)
    updatePetOverlay()
    showBubble(petQuote(pet, 'tsundere'))
  }
  return overlayEl
}

// 按 当前屏幕+闪光+饱食度 刷新浮标（screenId 由 router.show 传入；轮询时省略沿用当前屏）
// 显示范围：仅小窗模式（大屏界面不常驻立绘，桌宠陪伴由主菜单大图/小窗面板/桌宠悬浮窗承担）
export function updatePetOverlay(screenId) {
  ensurePetOverlay()
  const pet = activePet(G.profile)
  const miniMode = document.body.classList.contains('mini-mode')
  if (!pet || !miniMode || screenId === 'menu') {
    overlayEl.style.display = 'none'
    return
  }
  const state = computePetState(G.profile, screenId)
  const img = overlayEl.querySelector('#pet-overlay-img')
  if (state !== lastState) {
    img.src = chibiFor(pet, state)
    overlayEl.dataset.state = state
    lastState = state
  }
  overlayEl.style.display = ''
}

// 状态台词气泡（点击或状态切换时短暂显示）
export function showBubble(text) {
  ensurePetOverlay()
  const bubble = overlayEl.querySelector('#pet-overlay-bubble')
  if (!text) return
  bubble.textContent = text
  bubble.classList.add('show')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2600)
}

// 状态名（供调试/展示）
export function currentPetStateName() {
  return PET_STATE_NAMES[overlayEl?.dataset.state] || ''
}
