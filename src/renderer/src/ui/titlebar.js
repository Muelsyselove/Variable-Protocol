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
      <button class="tb-btn tb-min" id="tb-min" title="最小化">─</button>
      <button class="tb-btn tb-close" id="tb-close" title="关闭">✕</button>
    </div>
  </div>`)
  document.body.appendChild(titlebarEl)
  titlebarEl.querySelector('#tb-min').onclick = () => hasApi && window.api.minimize()
  titlebarEl.querySelector('#tb-close').onclick = () => hasApi && window.api.closeWindow()
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
  enterBtn.style.display = (!mini && inRun) ? '' : 'none'
  exitBtn.style.display = mini ? '' : 'none'
  pinBtn.style.display = mini ? '' : 'none'
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
