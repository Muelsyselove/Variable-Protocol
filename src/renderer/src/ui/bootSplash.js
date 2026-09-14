// 开屏界面（主窗口内覆盖层，非独立窗口）：品牌标识 / 启动进度 / 更新检查 / 自动下载安装
// 由 main.js 的 boot() 调用：并行执行「资源+存档加载」与「更新检查」，就绪后 resolve 进入主菜单。
// 「立即安装」不 resolve（运行安装包后应用退出）；资源加载失败时停留在错误提示。
// 视觉：信号实验室终端风（与主菜单同源）——等宽字体、绿色主色、直角边框、角括号面板；
// 按钮直接复用全局 .btn/.btn-mini 样式（base.css），配色取 :root CSS 变量。
import { checkUpdate, setLastCheck } from '../core/updater.js'

const CSS = `
.boot-splash {
  position: fixed; top: 34px; left: 0; right: 0; bottom: 0; z-index: 9999;
  background: rgba(7, 11, 16, 0.92); /* 半透明：透出全局背景网格与扫描线 */
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--ink); font-family: var(--sans);
  user-select: none; transition: opacity .25s ease;
}
.boot-splash.bs-fadeout { opacity: 0; pointer-events: none; }
.bs-head { text-align: center; margin-bottom: 34px; }
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
.bs-sub { font-size: 17px; letter-spacing: 13px; text-indent: 13px; margin: 10px 0 6px; color: var(--green); }
.bs-tagline { font-family: var(--mono); font-size: 12px; color: var(--ink-dim); letter-spacing: 3px; margin-top: 4px; }
.bs-ver { font-family: var(--mono); font-size: 11px; color: var(--ink-dim); letter-spacing: 2px; margin-top: 12px; }
.bs-panel {
  width: 480px; position: relative;
  background: linear-gradient(180deg, rgba(17, 26, 36, 0.92), rgba(10, 16, 23, 0.94));
  border: 1px solid var(--line);
  padding: 20px 24px;
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
 * @param {() => Promise<void>} loadTask 资源+存档加载（与更新检查并行执行）
 * @returns {Promise<void>} 可以进入主菜单时 resolve
 */
export function runBootSplash(loadTask) {
  return new Promise((resolve) => {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.className = 'boot-splash'
    root.innerHTML = `
      <div class="bs-head">
        <div class="bs-deco">// SIGNAL LAB · BOOT SEQUENCE</div>
        <div class="bs-title">VARIABLE<span class="bs-x">_</span>PROTOCOL</div>
        <div class="bs-sub">变 量 协 议</div>
        <div class="bs-tagline">肉鸽无限流 · 回合制骰子决斗</div>
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

    const setStatus = (text, err = false) => {
      const el = $('bs-status')
      el.textContent = text
      el.classList.toggle('err', err)
    }
    const setBar = (pct) => { $('bs-bar').style.width = `${Math.max(0, Math.min(100, pct))}%` }
    const finish = () => {
      root.classList.add('bs-fadeout')
      setTimeout(() => root.remove(), 260)
      resolve()
    }

    window.api?.appVersion?.().then((v) => { $('bs-ver').textContent = `v${v}` })
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
      // 加载任务（资源包 + 存档）与更新检查并行
      let loadErr = null
      const loading = Promise.resolve().then(loadTask).catch((err) => { loadErr = err })

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
        return // 停留在错误提示，不进入主菜单
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
        // 完成后按钮 / 稍后再说 均可见；进入主菜单由 finish() 驱动
      }
    })()
  })
}
