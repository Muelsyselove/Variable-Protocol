// 自定义窗口标题栏：融入背景，可拖动；右侧为（按状态显示）进入小窗/退出小窗、置顶、最小化、关闭
import { el } from './components.js'
import { G, applyWindowState, saveRun } from '../state.js'

const hasApi = typeof window !== 'undefined' && window.api

let titlebarEl = null

export function ensureTitlebar() {
  if (titlebarEl) return titlebarEl
  titlebarEl = el(`
  <div id="titlebar" class="titlebar">
    <div class="tb-title">
      <span class="tb-logo">◈</span>
      <span>变量协议 VARIABLE PROTOCOL</span>
    </div>
    <div class="tb-btns">
      <button class="tb-btn tb-mini-toggle" id="tb-mini-toggle" style="display:none" title="进入小窗模式">▢</button>
      <button class="tb-btn tb-exit-mini" id="tb-exit-mini" style="display:none" title="退出小窗模式">▣</button>
      <button class="tb-btn tb-pin" id="tb-pin" style="display:none" title="窗口置顶">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.5 L8 8 M8 1.5 L5.5 4 M8 1.5 L10.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 8.5 C3 11.5 5.5 12 8 12 C10.5 12 13 11.5 13 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="8" cy="13.6" r="1.1" fill="currentColor"/>
        </svg>
      </button>
      <button class="tb-btn tb-max" id="tb-max" style="display:none" title="最大化 / 还原">
        <svg class="ic-max" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        <svg class="ic-restore" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.3"/>
          <path d="M3.5 1.5 H10.5 V8.5" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      </button>
      <button class="tb-btn tb-min" id="tb-min" title="最小化">─</button>
      <button class="tb-btn tb-close" id="tb-close" title="关闭">✕</button>
    </div>
  </div>`)
  document.body.appendChild(titlebarEl)
  titlebarEl.querySelector('#tb-min').onclick = () => hasApi && window.api.minimize()
  titlebarEl.querySelector('#tb-close').onclick = () => hasApi && window.api.closeWindow()
  // 最大化状态由主进程推送（含 Aero Snap/双击标题栏等外部触发），保持图标同步
  if (hasApi) {
    window.api.onMaximizeChange?.((v) => {
      titlebarEl.querySelector('#tb-max')?.classList.toggle('maximized', !!v)
    })
  }
  return titlebarEl
}

// 按当前运行状态刷新标题栏（有进行中对局时显示小窗相关按钮）
export function updateTitlebar() {
  ensureTitlebar()
  const run = G.run
  const mini = !!run?.settings?.mini
  const inRun = !!run?.settings // 有进行中对局（含gameover临时标记）
  const enterBtn = titlebarEl.querySelector('#tb-mini-toggle')
  const exitBtn = titlebarEl.querySelector('#tb-exit-mini')
  const pinBtn = titlebarEl.querySelector('#tb-pin')
  const maxBtn = titlebarEl.querySelector('#tb-max')
  enterBtn.style.display = (!mini && inRun) ? '' : 'none'
  exitBtn.style.display = mini ? '' : 'none'
  pinBtn.style.display = mini ? '' : 'none'
  // 最大化仅大屏模式提供；小窗固定 460×400 不参与最大化
  maxBtn.style.display = (!mini && hasApi) ? '' : 'none'
  maxBtn.onclick = async () => {
    if (!hasApi) return
    const maximized = await window.api.toggleMaximize()
    maxBtn.classList.toggle('maximized', !!maximized)
  }
  pinBtn.classList.toggle('active', !!run?.settings?.alwaysOnTop)

  // 进入小窗：随时切入（自动启用自动协议）
  enterBtn.onclick = async () => {
    if (!G.run?.settings) return
    G.run.settings.mini = true
    if (G.run.settings.protocol === 'none') G.run.settings.protocol = 'auto'
    applyWindowState()
    await saveRun()
    const { show } = await import('../router.js')
    show('map')
  }

  // 退出小窗：关闭小窗与置顶并返回常规行动线
  exitBtn.onclick = async () => {
    if (!G.run?.settings) return
    G.run.settings.mini = false
    G.run.settings.alwaysOnTop = false
    applyWindowState()
    await saveRun()
    const { show } = await import('../router.js')
    show('map')
  }

  // 置顶切换（图钉图标：激活时点亮）
  pinBtn.onclick = async () => {
    if (!G.run?.settings) return
    G.run.settings.alwaysOnTop = !G.run.settings.alwaysOnTop
    updateTitlebar()
    applyWindowState()
    await saveRun()
  }
}
