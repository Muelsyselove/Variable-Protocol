// 登录界面（开屏后、主菜单前的账号门）：未登录展示登录/注册表单，已登录展示
// 掩码账号 + 开始游戏；服务器未配置/不可达时提供离线开始。
// 注册规则（v2.1.0）：用户名 2~24 位纯英文字母；密码 ≥8 位且同时包含字母和数字；
// 服务端自动分配 11 位纯数字账号（登录凭据，注册成功后完整展示一次，请玩家牢记）。
// 开始游戏时自动做一次「云端较新才恢复」的智能同步（本地更新则不被旧云端覆盖）。
import { show, registerScreen } from '../../router.js'
import { initProfile } from '../../state.js'
import { el, maskAccount } from '../components.js'
import { playSfx } from '../../core/sfx.js'

export function register() {
  registerScreen('login', renderLogin)
}

function renderLogin(root) {
  const cont = el(`
  <div class="screen screen-login">
    <div class="login-logo-wrap">
      <img class="login-logo" src="game://images/logo.png" alt="VARIABLE PROTOCOL" draggable="false"/>
      <div class="login-logo-sub">变 量 协 议</div>
    </div>

    <div class="login-panel panel">
      <!-- 已登录：欢迎视图 -->
      <div class="login-view" id="lv-welcome" style="display:none">
        <div class="login-welcome">欢迎回来</div>
        <div class="login-acc-label">// 游戏账号</div>
        <div class="login-acc" id="login-acc"></div>
        <div class="login-user dim" id="login-user"></div>
        <button class="btn btn-primary login-btn-start" id="btn-start">开 始 游 戏</button>
        <div class="login-status dim" id="login-sync-status"></div>
        <button class="btn btn-mini login-btn-switch" id="btn-switch">切换账号</button>
      </div>

      <!-- 未登录：登录/注册 -->
      <div class="login-view" id="lv-forms">
        <div class="login-tabs">
          <button class="login-tab active" data-tab="login">登 录</button>
          <button class="login-tab" data-tab="register">注 册</button>
        </div>

        <div class="login-form" id="lf-login">
          <label class="login-field"><span>账号</span>
            <input type="text" id="in-account" placeholder="11 位数字账号" maxlength="11" autocomplete="off"/>
          </label>
          <label class="login-field"><span>密码</span>
            <input type="password" id="in-pass" placeholder="密码" autocomplete="off"/>
          </label>
          <button class="btn btn-primary login-btn-submit" id="btn-login">登 录</button>
          <div class="login-status dim" id="login-status"></div>
        </div>

        <div class="login-form" id="lf-register" style="display:none">
          <label class="login-field"><span>用户名</span>
            <input type="text" id="in-reg-user" placeholder="2~24 位英文字母" maxlength="24" autocomplete="off"/>
          </label>
          <label class="login-field"><span>密码</span>
            <input type="password" id="in-reg-pass" placeholder="不低于 8 位，含字母和数字" autocomplete="off"/>
          </label>
          <label class="login-field"><span>确认密码</span>
            <input type="password" id="in-reg-pass2" placeholder="再次输入密码" autocomplete="off"/>
          </label>
          <button class="btn btn-primary login-btn-submit" id="btn-register">注 册</button>
          <div class="login-status dim" id="reg-status"></div>
        </div>

        <!-- 注册成功：账号完整展示（仅此一次完整显示，请玩家牢记） -->
        <div class="login-regdone" id="lf-regdone" style="display:none">
          <div class="login-regdone-title">// 注册成功</div>
          <div class="login-regdone-note">系统已为你分配游戏账号，<b>登录需使用账号，请牢记：</b></div>
          <div class="login-regdone-acc" id="regdone-acc"></div>
          <button class="btn btn-mini" id="btn-copy-acc">复制账号</button>
          <div class="login-status dim" id="copy-status"></div>
          <button class="btn btn-primary login-btn-submit" id="btn-regdone-go">进入游戏</button>
        </div>
      </div>
    </div>

    <button class="btn btn-ghost login-offline" id="btn-offline">离线开始 →</button>
    <div class="login-foot dim" id="login-foot"></div>
  </div>`)
  root.appendChild(cont)

  const status = (sel, text, cls) => {
    const s = cont.querySelector(sel)
    s.textContent = text || ''
    s.className = 'login-status ' + (cls || 'dim')
  }

  window.api?.appVersion?.().then((v) => {
    cont.querySelector('#login-foot').textContent = `变量协议 v${v} · 登录后自动同步云端存档，离线开始则仅使用本地数据`
  })

  // ── 视图切换 ──
  const welcome = cont.querySelector('#lv-welcome')
  const forms = cont.querySelector('#lv-forms')
  function renderState(st) {
    if (st?.loggedIn) {
      forms.style.display = 'none'
      welcome.style.display = ''
      cont.querySelector('#login-acc').textContent = maskAccount(st.account || '')
      cont.querySelector('#login-user').textContent = st.username ? `用户名 ${st.username}` : ''
    } else {
      welcome.style.display = 'none'
      forms.style.display = ''
      if (!st?.configured) {
        status('#login-status', '服务器未配置，可离线开始（账号功能不可用）')
        cont.querySelector('#btn-login').disabled = true
        cont.querySelector('#btn-register').disabled = true
      }
    }
  }
  window.api?.serverStatus?.().then(async (st) => {
    // 旧版本登录的本机会话未存账号：向服务器补全（失败不阻塞，按原状态渲染）
    if (st?.loggedIn && !st.account && window.api?.serverMe) {
      try { st = await window.api.serverMe() } catch { /* 保持原状态 */ }
    }
    renderState(st)
  })

  // 登录/注册选项卡
  cont.querySelectorAll('.login-tab').forEach((tab) => {
    tab.onclick = () => {
      playSfx('click')
      cont.querySelectorAll('.login-tab').forEach((t) => t.classList.toggle('active', t === tab))
      const isLogin = tab.dataset.tab === 'login'
      cont.querySelector('#lf-login').style.display = isLogin ? '' : 'none'
      const reg = cont.querySelector('#lf-register')
      const done = cont.querySelector('#lf-regdone')
      // 注册成功视图只出现一次；切回注册页时显示表单
      if (!isLogin && done.style.display === 'none') reg.style.display = ''
      if (isLogin) reg.style.display = 'none'
    }
  })

  const enterGame = async () => {
    playSfx('toggle')
    show('menu')
  }

  // ── 开始游戏：已登录则先智能同步云端存档（云端较新才恢复） ──
  cont.querySelector('#btn-start').onclick = async () => {
    const btn = cont.querySelector('#btn-start')
    btn.disabled = true
    status('#login-sync-status', '正在同步云端存档…')
    try {
      const r = await window.api.cloudPullIfNewer()
      if (r?.ok && r.pulled) {
        await initProfile() // 云端档案已写入本地，重新加载内存态
        status('#login-sync-status', '云端存档已恢复 ✓')
      } else if (r?.ok) {
        status('#login-sync-status', '')
      } else {
        status('#login-sync-status', r?.error || '云端同步失败，使用本地数据继续', 'err')
      }
    } catch {
      status('#login-sync-status', '云端同步失败，使用本地数据继续', 'err')
    }
    await enterGame()
  }

  // ── 登录 ──
  cont.querySelector('#btn-login').onclick = async () => {
    const account = cont.querySelector('#in-account').value.trim()
    const password = cont.querySelector('#in-pass').value
    if (!/^\d{11}$/.test(account)) { status('#login-status', '账号需为 11 位数字', 'err'); return }
    if (!password) { status('#login-status', '请输入密码', 'err'); return }
    status('#login-status', '登录中…')
    const r = await window.api.serverLogin({ username: account, password })
    if (!r.ok) { status('#login-status', `登录失败：${r.error}`, 'err'); return }
    status('#login-status', '登录成功 ✓', 'ok')
    playSfx('toggle')
    renderState(await window.api.serverStatus())
  }

  // ── 注册 ──
  cont.querySelector('#btn-register').onclick = async () => {
    const username = cont.querySelector('#in-reg-user').value.trim()
    const password = cont.querySelector('#in-reg-pass').value
    const password2 = cont.querySelector('#in-reg-pass2').value
    if (!/^[A-Za-z]{2,24}$/.test(username)) { status('#reg-status', '用户名需为 2~24 位英文字母', 'err'); return }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      status('#reg-status', '密码需不低于 8 位，且同时包含字母和数字', 'err'); return
    }
    if (password !== password2) { status('#reg-status', '两次输入的密码不一致', 'err'); return }
    status('#reg-status', '注册中…')
    const r = await window.api.serverRegister({ username, password })
    if (!r.ok) { status('#reg-status', `注册失败：${r.error}`, 'err'); return }
    playSfx('toggle')
    // 注册成功：完整展示账号（仅此一次）
    const st = await window.api.serverStatus()
    const acc = st?.account || ''
    cont.querySelector('#lf-register').style.display = 'none'
    const done = cont.querySelector('#lf-regdone')
    done.style.display = ''
    cont.querySelector('#regdone-acc').textContent = acc
    done.querySelector('#btn-copy-acc').onclick = () => {
      const ta = document.createElement('textarea')
      ta.value = acc
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      status('#copy-status', ok ? '已复制到剪贴板 ✓' : '复制失败，请手动抄录', ok ? 'ok' : 'err')
    }
  }

  // 注册成功 → 进入游戏（已自动登录）
  cont.querySelector('#btn-regdone-go').onclick = async () => {
    renderState(await window.api.serverStatus())
    // 直接走开始游戏流程（含云端同步）
    cont.querySelector('#btn-start').click()
  }

  // ── 切换账号（登出本机凭据，回到表单） ──
  cont.querySelector('#btn-switch').onclick = async () => {
    await window.api.serverLogout()
    show('login') // 重渲染为未登录视图
  }

  // ── 离线开始 ──
  cont.querySelector('#btn-offline').onclick = () => enterGame()
}
