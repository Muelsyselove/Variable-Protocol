// 开屏界面（主窗口内覆盖层，非独立窗口）：大字 Logo 快速淡入 / 启动进度 / 更新检查 / 自动下载安装
// 由 main.js 的 boot() 调用：并行执行「资源+存档加载」与「更新检查」，就绪后 resolve 进入登录界面。
// 「立即安装」不 resolve（运行安装包后应用退出）；资源加载失败时停留在错误提示。
// 视觉：信号实验室终端风（与主菜单同源）——等宽字体、绿色主色、直角边框、角括号面板；
// 大字 Logo 为 MCP 生成的 4K 透明 PNG（resources/game/images/logo.png，game:// 加载），
// 图片缺失/加载失败时回落文字标题。覆盖层 top:34px 让出标题栏——任何情况下不遮挡
// 最小化/最大化/关闭按钮。
import { checkUpdate, setLastCheck } from '../core/updater.js'

const CSS = `
.boot-splash {
  position: fixed; top: 34px; left: 0; right: 0; bottom: 0; z-index: 9999;
  background: rgba(7, 11, 16, 0.92); /* 半透明：透出全局背景网格与扫描线 */
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--ink); font-family: var(--sans);
  user-select: none; opacity: 0; transition: opacity .35s ease;
}
.boot-splash.bs-in { opacity: 1; }
.boot-splash.bs-fadeout { opacity: 0; pointer-events: none; transition: opacity .3s ease; }
.bs-logo-wrap {
  position: relative;
  margin-bottom: 38px;
}
/* Logo 高空坠落动画：屏幕面 = 地面，垂直于屏幕的轴线 = 高度轴。
   Logo 从该轴高处（贴近观者，视觉显大 scale 2.8）加速坠落到屏幕面（scale 1），
   下落即远离观者 → 逐渐缩小；落地压扁 → 小幅回弹（约 0.85s，与 JS 时序常量 DROP_MS 对应）。
   分段缓动写在关键帧内：坠落段加速（重力），落地后回弹段 ease-out */
.bs-logo-inner {
  animation: bsDrop 0.85s linear both;
}
@keyframes bsDrop {
  0%   { transform: scale(2.8); opacity: 0; animation-timing-function: cubic-bezier(0.4, 0, 0.8, 0.4); }
  10%  { opacity: 1; }
  62%  { transform: scale(1); animation-timing-function: ease-out; }  /* 落到屏幕面瞬间 */
  74%  { transform: scale(1.06, 0.88); animation-timing-function: ease-out; }  /* 冲击压扁 */
  87%  { transform: scale(0.99, 1.05); animation-timing-function: ease-in-out; }  /* 小幅回弹 */
  100% { transform: none; }  /* 落定 */
}
/* 落地彩色涟漪：四色光环自 Logo 中心扩散（.landed 由 JS 在落地时刻添加） */
.bs-ripples {
  position: absolute;
  left: 50%;
  top: 44%;
  width: 0;
  height: 0;
  pointer-events: none;
}
.bs-ripple {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 90px;
  height: 90px;
  margin: -45px 0 0 -45px;
  border-radius: 50%;
  border: 2px solid;
  opacity: 0;
  transform: scale(0);
}
.bs-logo-wrap.landed .bs-ripple { animation: bsRipple 1.7s cubic-bezier(0.16, 0.6, 0.35, 1) forwards; }
.bs-logo-wrap.landed .bs-ripple:nth-child(1) { border-color: var(--green); animation-delay: 0s; }
.bs-logo-wrap.landed .bs-ripple:nth-child(2) { border-color: var(--cyan); animation-delay: 0.16s; }
.bs-logo-wrap.landed .bs-ripple:nth-child(3) { border-color: var(--violet); animation-delay: 0.32s; }
.bs-logo-wrap.landed .bs-ripple:nth-child(4) { border-color: var(--amber); animation-delay: 0.48s; }
@keyframes bsRipple {
  0%   { opacity: 0.85; transform: scale(0); }
  100% { opacity: 0; transform: scale(15); }
}
/* Logo 交接飞行：开屏→登录界面时平滑移动到登录页目标位（FLIP 手法） */
.bs-travel {
  position: fixed;
  z-index: 10001;
  margin: 0;
  height: auto;
  transform-origin: top left;
  pointer-events: none;
  filter: drop-shadow(0 6px 30px rgba(0, 0, 0, 0.6));
  transition: transform .68s cubic-bezier(0.35, 0.7, 0.25, 1);
  will-change: transform;
}
@keyframes bsLogoGlow { 50% { filter: drop-shadow(0 0 26px rgba(62, 224, 143, 0.22)); } }
.bs-logo {
  display: block;
  width: min(680px, 62vw);
  height: auto;
  filter: drop-shadow(0 6px 30px rgba(0, 0, 0, 0.6));
}
.bs-sub {
  font-size: 15px; letter-spacing: 12px; text-indent: 12px;
  margin-top: 14px; color: var(--green); text-align: center;
}
/* 文字回落（Logo 图片缺失时） */
.bs-head { text-align: center; margin-bottom: 38px; }
.bs-deco {
  font-family: var(--mono); font-size: 11px; letter-spacing: 4px;
  color: var(--ink-dim); margin-bottom: 16px;
}
.bs-title {
  font-family: var(--mono); font-size: 42px; font-weight: 300;
  letter-spacing: 8px; color: var(--ink);
  text-shadow: 0 0 40px rgba(62, 224, 143, 0.25);
}
.bs-x { color: var(--green); animation: bsBlink 1.1s step-end infinite; }
@keyframes bsBlink { 50% { opacity: 0; } }
.bs-ver { font-family: var(--mono); font-size: 11px; color: var(--ink-dim); letter-spacing: 2px; margin-top: 12px; }
.bs-panel {
  width: 460px; position: relative;
  background: linear-gradient(180deg, rgba(17, 26, 36, 0.92), rgba(10, 16, 23, 0.94));
  border: 1px solid var(--line);
  padding: 18px 22px;
}
.bs-panel::before, .bs-panel::after { content: ''; position: absolute; width: 14px; height: 14px; pointer-events: none; }
.bs-panel::before { top: -1px; left: -1px; border-top: 2px solid var(--line-hi); border-left: 2px solid var(--line-hi); }
.bs-panel::after { bottom: -1px; right: -1px; border-bottom: 2px solid var(--line-hi); border-right: 2px solid var(--line-hi); }
.bs-status {
  font-family: var(--mono); font-size: 13px; letter-spacing: 2px;
  color: var(--ink-dim); min-height: 20px;
}
.bs-status::after { content: '▌'; color: var(--green); animation: bsBlink 1.1s step-end infinite; margin-left: 4px; }
.bs-status.err { color: var(--amber); }
.bs-status.err::after { content: ''; animation: none; }
.bs-bar {
  height: 12px; background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--line); position: relative; overflow: hidden; margin-top: 12px;
}
.bs-bar-fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #2a9d68, var(--green));
  transition: width .25s ease;
}
.bs-update-box { display: none; margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; text-align: left; }
.bs-update-title { font-family: var(--mono); font-size: 13px; letter-spacing: 2px; color: var(--amber); margin-bottom: 6px; }
.bs-update-notes { font-size: 12px; color: var(--ink-dim); line-height: 1.7; max-height: 130px; overflow-y: auto; white-space: pre-wrap; }
.bs-btns { display: none; gap: 10px; justify-content: center; margin-top: 16px; }
.bs-foot { position: absolute; bottom: 16px; font-family: var(--mono); font-size: 11px; color: var(--ink-dim); letter-spacing: 2px; opacity: .7; }
`

/**
 * 挂载开屏覆盖层并执行启动序列。
 * @param {() => Promise<void>} loadTask 资源+存档加载（从启动即刻并行执行）
 * @param {() => (Element|null)} [handoff] 交接钩子：渲染登录界面并返回其 Logo 元素（供平滑飞行到目标位）
 * @returns {Promise<void>} 可以进入登录界面时 resolve
 */
export function runBootSplash(loadTask, handoff) {
  return new Promise((resolve) => {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.className = 'boot-splash'
    root.innerHTML = `
      <div class="bs-logo-wrap" id="bs-logo-wrap">
        <div class="bs-ripples"><i class="bs-ripple"></i><i class="bs-ripple"></i><i class="bs-ripple"></i><i class="bs-ripple"></i></div>
        <div class="bs-logo-inner">
          <img class="bs-logo" id="bs-logo" src="game://images/logo.png" alt="VARIABLE PROTOCOL" draggable="false"/>
          <div class="bs-sub">变 量 协 议</div>
        </div>
      </div>
      <div class="bs-head" id="bs-head" style="display:none">
        <div class="bs-deco">// SIGNAL LAB · BOOT SEQUENCE</div>
        <div class="bs-title">VARIABLE<span class="bs-x">_</span>PROTOCOL</div>
        <div class="bs-sub">变 量 协 议</div>
        <div class="bs-ver" id="bs-ver"></div>
      </div>
      <div class="bs-panel">
        <div class="bs-status" id="bs-status">正在初始化…</div>
        <div class="bs-bar"><div class="bs-bar-fill" id="bs-bar"></div></div>
        <div class="bs-update-box" id="bs-update-box">
          <div class="bs-update-title" id="bs-update-title"></div>
          <div class="bs-update-notes" id="bs-update-notes"></div>
        </div>
        <div class="bs-btns" id="bs-btns">
          <button class="btn btn-mini btn-primary" id="bs-install">立即安装</button>
          <button class="btn btn-mini" id="bs-later">稍后再说</button>
        </div>
      </div>
      <div class="bs-foot">// SIGNAL LAB · OPEN SOURCE (AGPL-3.0)</div>`
    document.body.appendChild(root)
    const $ = (id) => root.querySelector(`#${id}`)

    // 快速淡入（下一帧触发过渡）
    requestAnimationFrame(() => root.classList.add('bs-in'))

    // Logo 加载失败（资源缺失/损坏）→ 回落文字标题（同样带坠落动画）
    $('bs-logo').onerror = () => {
      $('bs-logo-wrap').style.display = 'none'
      const head = $('bs-head')
      head.style.animation = 'bsDrop 0.85s linear both'
      head.style.display = 'block'
    }
    // 文字回落时才显示版本号；正常 Logo 下版本号挂在副标题下方
    const verEl = $('bs-ver')
    const logoWrap = $('bs-logo-wrap')
    const verUnderLogo = document.createElement('div')
    verUnderLogo.className = 'bs-ver'
    verUnderLogo.style.textAlign = 'center'
    verUnderLogo.style.marginTop = '10px'
    logoWrap.appendChild(verUnderLogo)

    const setStatus = (text, err = false) => {
      const el = $('bs-status')
      el.textContent = text
      el.classList.toggle('err', err)
    }
    const setBar = (pct) => { $('bs-bar').style.width = `${Math.max(0, Math.min(100, pct))}%` }
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      // ── 无缝交接：渲染登录界面，克隆开屏 Logo 平滑飞行到登录页目标位 ──
      let target = null
      try { target = handoff?.() || null } catch { target = null }
      let travel = null
      if (target) {
        try {
          const from = $('bs-logo').getBoundingClientRect()
          if (from.width > 10 && root.contains($('bs-logo'))) {
            target.decode?.().catch(() => { /* 解码失败按原样显示 */ })
            target.style.visibility = 'hidden' // 目标位先隐藏，避免双重 Logo
            const to = target.getBoundingClientRect()
            travel = $('bs-logo').cloneNode()
            travel.className = 'bs-travel'
            travel.style.left = `${from.left}px`
            travel.style.top = `${from.top}px`
            travel.style.width = `${from.width}px`
            document.body.appendChild(travel)
            const dx = to.left - from.left
            const dy = to.top - from.top
            const s = to.width / from.width
            // 双 rAF 确保初始状态先渲染，再触发过渡
            requestAnimationFrame(() => requestAnimationFrame(() => {
              travel.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`
            }))
          } else {
            travel = null
          }
        } catch {
          travel = null
        }
      }
      // 开屏其余部分（背景/面板/涟漪）淡出，露出底层登录界面
      root.classList.add('bs-fadeout')
      setTimeout(() => root.remove(), 400)
      // 到达目标位：移除飞行克隆、显示真实 Logo，交接完成
      setTimeout(() => {
        travel?.remove()
        if (target) target.style.visibility = ''
        resolve()
      }, travel ? 720 : 150)
    }

    window.api?.appVersion?.().then((v) => {
      verEl.textContent = `v${v}`
      verUnderLogo.textContent = `v${v}`
    })
    $('bs-later').onclick = finish
    $('bs-install').onclick = async () => {
      $('bs-install').disabled = true
      setStatus('正在启动安装程序…')
      const r = await window.api.installUpdate()
      if (!r?.ok) {
        $('bs-install').disabled = false
        setStatus(r?.error || '安装失败', true)
      }
    }

    // 下载进度（主进程推送；先注册监听再发起下载，无时序问题）
    window.api?.onDownloadProgress?.((p) => {
      if (p.failed) {
        setStatus('下载失败，请稍后重试或前往发布页手动下载', true)
        $('bs-btns').style.display = 'flex'
        $('bs-install').style.display = 'none'
        return
      }
      setBar(40 + p.percent * 0.6)
      const mb = (n) => (n / 1048576).toFixed(1)
      setStatus(p.done ? '下载完成，可以安装' : `正在下载更新… ${p.percent}%（${mb(p.received)}/${mb(p.total)} MB）`)
      if (p.done) {
        setBar(100)
        $('bs-btns').style.display = 'flex'
      }
    })

    ;(async () => {
      // 加载任务（资源包 + 存档）立即并行执行；更新检查按用户要求延后到 Logo 动画结束后 0.5 秒
      let loadErr = null
      const loading = Promise.resolve().then(loadTask).catch((err) => { loadErr = err })

      // ── 坠落动画时序：落地瞬间（62%）触发彩色涟漪；动画结束（850ms）+0.5s 再检查更新 ──
      const DROP_MS = 850 // 与 CSS bsDrop 动画总时长一致
      setTimeout(() => logoWrap.classList.add('landed'), Math.round(DROP_MS * 0.62))
      setBar(12)
      await new Promise((r) => setTimeout(r, DROP_MS + 500))

      // ── 更新检查（渲染层驱动：主进程执行并记录结果，菜单红点数据源）──
      setStatus('正在检查更新…')
      setBar(30)
      const res = await checkUpdate()
      setLastCheck(res)

      // 等加载完成（开屏期间已并行执行，通常即刻返回）
      await loading
      if (loadErr) {
        console.error('[资源加载失败]', loadErr)
        setStatus('游戏资源加载失败：请重新安装，或在「系统设置 → 资源版本」执行修复', true)
        $('bs-update-notes').textContent = String(loadErr?.message || loadErr)
        $('bs-update-box').style.display = 'block'
        return // 停留在错误提示，不进入登录界面
      }

      if (!res?.ok) {
        setStatus('更新检查失败（网络异常），继续启动', true)
        setBar(100)
        setTimeout(finish, 900)
      } else if (res.dev) {
        setStatus('开发模式')
        setBar(100)
        setTimeout(finish, 500)
      } else if (!res.updateAvailable) {
        setStatus(`已是最新版本 v${res.current ?? ''}`)
        setBar(100)
        setTimeout(finish, 600)
      } else {
        // 发现新版本：展示信息并自动下载
        const L = res.latest || {}
        setStatus(`发现新版本 v${L.version}`)
        setBar(40)
        $('bs-update-title').textContent = `新版本 v${L.version}${L.name ? ' · ' + L.name : ''}`
        $('bs-update-notes').textContent = (L.notes || '').split('\n').filter((l) => l.trim()).slice(0, 12).join('\n') || '（无更新说明）'
        $('bs-update-box').style.display = 'block'
        const r = await window.api.downloadUpdate()
        if (!r?.ok) {
          setStatus(r?.error || '自动下载不可用，可前往发布页手动下载', true)
          $('bs-btns').style.display = 'flex'
          $('bs-install').style.display = 'none'
        } else {
          setStatus('正在下载更新…')
        }
        // 完成后按钮 / 稍后再说 均可见；进入登录界面由 finish() 驱动
      }
    })()
  })
}
