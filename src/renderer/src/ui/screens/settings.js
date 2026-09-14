// 设置界面（v2.1.0 四分类）：账号（改密/注销/登出/云同步）｜AI 与自动协议（接口/方案池/进化）｜
// 通用（声音/小窗模式/数据目录）｜版本与资源（更新/资源版本）；底部提供返回与退出终端（确认弹窗）。
// 登录/注册在游戏启动前的登录界面完成（screens/login.js），此处仅保留账号操作。
import { show, registerScreen } from '../../router.js'
import { G, saveProfile } from '../../state.js'
import { aiChat, generateAgentConfig, aiConfigured } from '../../core/aiService.js'
import { defaultAgentConfig } from '../../core/agentConfig.js'
import {
  getSchemes, getActiveScheme, createScheme, updateScheme, renameScheme, deleteScheme, activateScheme
} from '../../core/schemes.js'
import { setSfxEnabled, setSfxVolume, playSfx } from '../../core/sfx.js'
import { checkUpdate, getLastCheck } from '../../core/updater.js'
import { el, showConfirm } from '../components.js'

export function register() {
  registerScreen('settings', renderSettings)
}

// 分类页（切换状态跨渲染保留，方便从账号操作返回后仍在原页）
const TABS = [
  { id: 'account', label: '账号' },
  { id: 'ai', label: 'AI 与自动协议' },
  { id: 'general', label: '通用' },
  { id: 'version', label: '版本与资源' }
]
let lastTab = 'account'

function renderSettings(root, params) {
  const ai = G.profile.ai
  const miniStyle = G.profile.miniStyle === 'pet' ? 'pet' : 'hub'
  const cont = el(`
  <div class="screen screen-settings">
    <div class="settings-head">
      <div class="crumb">// TERMINAL · 设置</div>
      <h2>系统设置</h2>
      <div class="settings-tabs">
        ${TABS.map((t) => `<button class="set-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
    </div>
    <div class="settings-body">

      <!-- ═══ 分类：账号 ═══ -->
      <div class="settings-pane" data-pane="account">
        <div class="settings-col panel">
          <div class="set-title">// 账号状态</div>
          <div class="set-note dim">登录与注册在游戏启动前完成。登录后玩家档案（算力币、桌宠、方案池等局外数据）自动云端同步：开始游戏时云端较新则自动恢复，退出游戏时自动上传。</div>
          <div class="cloud-state dim" id="cloud-state">读取中…</div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-cloud-push">上传存档</button>
            <button class="btn btn-mini" id="btn-cloud-pull">恢复云端存档</button>
          </div>
          <div class="set-status dim" id="cloud-status"></div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 修改密码</div>
          <label class="set-row"><span class="k">原密码</span>
            <input type="password" id="pw-old" placeholder="当前密码" autocomplete="off"/>
          </label>
          <label class="set-row"><span class="k">新密码</span>
            <input type="password" id="pw-new" placeholder="不低于 8 位，含字母和数字" autocomplete="off"/>
          </label>
          <label class="set-row"><span class="k">确认新密码</span>
            <input type="password" id="pw-new2" placeholder="再次输入新密码" autocomplete="off"/>
          </label>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-pw-change">修改密码</button>
            <span class="set-status dim" id="pw-status"></span>
          </div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 账号操作</div>
          <div class="set-note dim">登出仅清除本机登录状态，账号保留；注销账号将<b>永久删除账号与云端存档（不可恢复）</b>，本地档案保留但不再同步。</div>
          <label class="set-row"><span class="k">账号密码</span>
            <input type="password" id="del-pass" placeholder="注销需输入密码确认" autocomplete="off"/>
          </label>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-logout">登出</button>
            <button class="btn btn-mini btn-warn" id="btn-del-account">注销账号</button>
            <span class="set-status dim" id="acc-status"></span>
          </div>
        </div>
      </div>

      <!-- ═══ 分类：AI 与自动协议 ═══ -->
      <div class="settings-pane" data-pane="ai" style="display:none">
        <div class="settings-col panel">
          <div class="set-title">// AI 接口</div>
          <div class="set-note dim">OpenAI 兼容接口。地址可直接填 Base URL（自动补全 /chat/completions），如 https://api.openai.com/v1 、https://dashscope.aliyuncs.com/compatible-mode/v1 、http://localhost:11434 。用于智慧代理实时决策与AI编写优先级。</div>
          <label class="set-row"><span class="k">接口地址</span>
            <input type="text" id="ai-endpoint" placeholder="https://api.openai.com/v1/chat/completions" value="${ai.endpoint}"/>
          </label>
          <label class="set-row"><span class="k">API 密钥</span>
            <input type="password" id="ai-key" placeholder="sk-..." value="${ai.apiKey}"/>
          </label>
          <label class="set-row"><span class="k">模型</span>
            <input type="text" id="ai-model" placeholder="gpt-4o-mini" value="${ai.model}"/>
          </label>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-ai-save">保存配置</button>
            <button class="btn btn-mini" id="btn-ai-test">测试连接</button>
            <span class="set-status dim" id="ai-status"></span>
          </div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 自动协议方案池</div>
          <div class="set-note dim">自动协议（自动代理）按方案处理开局选择、事件选项、商店购买、奖励关、BOSS掉落与核心放置。可保存多个方案并随时切换。</div>
          <div class="scheme-list" id="scheme-list"></div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-scheme-new">新建方案</button>
            <button class="btn btn-mini btn-primary" id="btn-scheme-ai-new" ${aiConfigured() ? '' : 'disabled'}>AI新建方案</button>
            <button class="btn btn-mini" id="btn-scheme-ai-adjust" ${aiConfigured() ? '' : 'disabled'}>AI调整当前方案</button>
          </div>
          <textarea id="agent-pref" class="set-textarea" placeholder="策略偏向（供AI新建/调整时参考，可选），例如：&#10;激进速攻，优先攻击力和伤害转译器；生命长期保持健康；事件里倾向冒险"></textarea>
          <div class="set-status dim" id="agent-status"></div>
          <div class="agent-config-view" id="agent-config-view"></div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 进化模式</div>
          <div class="set-row"><span class="k">进化模式</span>
            <label class="set-switch"><input type="checkbox" id="evo-enabled" ${G.profile.evolution ? 'checked' : ''}/><span class="set-switch-text">${G.profile.evolution ? '已开启' : '已关闭'}</span></label>
          </div>
          <div class="set-note dim">开启后，每局结束（自动代理协议下）将本局实战数据发送给AI，调优当前激活的方案并替换；配合连战时下一局即使用调优后的方案，循环进化。需配置AI接口。</div>
        </div>
      </div>

      <!-- ═══ 分类：通用 ═══ -->
      <div class="settings-pane" data-pane="general" style="display:none">
        <div class="settings-col panel">
          <div class="set-title">// 声音</div>
          <div class="set-row"><span class="k">音效开关</span>
            <label class="set-switch"><input type="checkbox" id="snd-enabled" ${G.profile.sound?.enabled !== false ? 'checked' : ''}/><span class="set-switch-text">${G.profile.sound?.enabled !== false ? '已开启' : '已关闭'}</span></label>
          </div>
          <div class="set-row"><span class="k">主音量</span>
            <input type="range" id="snd-volume" min="0" max="100" value="${Math.round((G.profile.sound?.volume ?? 0.8) * 100)}"/>
            <span class="dim" id="snd-vol-text">${Math.round((G.profile.sound?.volume ?? 0.8) * 100)}%</span>
          </div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-snd-test">试听</button>
            <span class="set-status dim">音效实时生效并自动保存</span>
          </div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 小窗模式</div>
          <div class="set-note dim">选择进入小窗模式后的呈现形式。切换后下次进入小窗生效。</div>
          <div class="mini-style-opts">
            <div class="ms-opt ${miniStyle === 'hub' ? 'active' : ''}" data-style="hub">
              <div class="ms-opt-name">常规小窗</div>
              <div class="ms-opt-desc dim">信息中枢：状态、层数、通量、桌宠面板与操作按钮并排展示。</div>
            </div>
            <div class="ms-opt ${miniStyle === 'pet' ? 'active' : ''}" data-style="pet">
              <div class="ms-opt-name">桌宠模式</div>
              <div class="ms-opt-desc dim">桌面悬浮窗：隐藏游戏窗口后台自动推进，屏幕上仅显示桌宠与消息气泡（正在战斗/正在决策等）。左键点击互动、按住拖动、右键打开操作菜单（饱食度/好感度/购买食物/喂食/更换协议/更换桌宠/返回大屏）。</div>
            </div>
          </div>
        </div>

        <div class="settings-col panel">
          <div class="set-title">// 数据目录</div>
          <div class="set-note dim">存档（档案与对局数据）的保存位置。更改时自动把现有存档迁移到新目录，原位置保留为备份，不删除任何数据；不可指向安装目录内（升级/卸载会整目录删除）。切换后建议重启以完全生效。</div>
          <div class="data-dir-path" id="data-dir-path">读取中…</div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-data-dir-choose">更改数据目录…</button>
            <button class="btn btn-mini" id="btn-data-dir-reset">恢复默认位置</button>
          </div>
          <div class="set-status dim" id="data-dir-status"></div>
        </div>
      </div>

      <!-- ═══ 分类：版本与资源 ═══ -->
      <div class="settings-pane" data-pane="version" style="display:none">
        <div class="settings-col panel">
          <div class="set-title">// 版本与更新</div>
          <div class="set-row"><span class="k">当前版本</span>
            <span id="upd-current" class="dim">读取中…</span>
          </div>
          <div class="set-note dim">启动时开屏界面会自动检查更新并在发现新版本时自动下载安装包；也可在此手动检查。安装包下载完成后可在开屏界面一键安装。</div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-upd-check">检查更新</button>
            <button class="btn btn-mini" id="btn-upd-open" style="display:none">前往下载</button>
          </div>
          <div class="set-status dim" id="upd-status"></div>
          <div class="upd-result" id="upd-result" style="display:none">
            <div class="upd-ver" id="upd-ver"></div>
            <div class="upd-notes dim" id="upd-notes"></div>
          </div>
        </div>
        <div class="settings-col panel">
          <div class="set-title">// 资源版本</div>
          <div class="set-note dim">游戏资源（转译器/骰子/敌人/干员/武器/事件/桌宠定义与全部图片）已与游戏核心分离存放，可独立更新。修复会清除已下载的资源更新并回退到随安装包发布的版本（不影响存档）。</div>
          <div class="set-row"><span class="k">资源版本</span>
            <span id="res-version" class="dim">读取中…</span>
          </div>
          <div class="set-actions">
            <button class="btn btn-mini" id="btn-res-update">检查资源更新</button>
            <button class="btn btn-mini btn-warn" id="btn-res-repair">修复资源</button>
          </div>
          <div class="set-status dim" id="res-status"></div>
        </div>
      </div>
    </div>

    <div class="settings-foot">
      <button class="btn btn-warn" id="btn-exit">退出终端</button>
      <button class="btn btn-primary" id="btn-back">返回</button>
    </div>
  </div>`)
  root.appendChild(cont)

  const status = (sel, text, cls) => {
    const s = cont.querySelector(sel)
    s.textContent = text
    s.className = 'set-status ' + (cls || 'dim')
  }

  // ── 分类切换 ──
  function switchTab(tabId) {
    lastTab = TABS.some((t) => t.id === tabId) ? tabId : 'account'
    cont.querySelectorAll('.set-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === lastTab))
    cont.querySelectorAll('.settings-pane').forEach((p) => {
      p.style.display = p.dataset.pane === lastTab ? '' : 'none'
    })
  }
  cont.querySelectorAll('.set-tab').forEach((b) => { b.onclick = () => { playSfx('click'); switchTab(b.dataset.tab) } })
  switchTab(lastTab)

  // ═══ 账号分类 ═══
  const cloudStateEl = cont.querySelector('#cloud-state')
  const btnPush = cont.querySelector('#btn-cloud-push')
  const btnPull = cont.querySelector('#btn-cloud-pull')
  const btnPwChange = cont.querySelector('#btn-pw-change')
  const btnLogout = cont.querySelector('#btn-logout')
  const btnDel = cont.querySelector('#btn-del-account')
  const delPass = cont.querySelector('#del-pass')
  let accState = null

  function renderAccountState(st) {
    accState = st
    const loggedIn = !!st?.loggedIn
    if (!st?.configured) {
      cloudStateEl.textContent = '服务器未配置，账号功能不可用（可离线游玩）'
    } else if (loggedIn) {
      cloudStateEl.innerHTML = `已登录 · 账号 <b class="acc-full">${st.account || ''}</b>${st.username ? ` · 用户名 ${st.username}` : ''}`
    } else {
      cloudStateEl.textContent = '离线模式（未登录）：重启游戏可在启动前登录账号'
    }
    btnPush.disabled = !loggedIn
    btnPull.disabled = !loggedIn
    btnPwChange.disabled = !loggedIn
    btnLogout.disabled = !loggedIn
    btnDel.disabled = !loggedIn
    delPass.disabled = !loggedIn
  }
  window.api?.serverStatus?.().then(async (st) => {
    // 旧版本登录的本机会话未存账号：向服务器补全（失败不阻塞）
    if (st?.loggedIn && !st.account && window.api?.serverMe) {
      try { st = await window.api.serverMe() } catch { /* 保持原状态 */ }
    }
    renderAccountState(st)
  })

  // 手动云同步
  btnPush.onclick = async () => {
    if (!(await showConfirm('上传云端存档', '将当前玩家档案上传到云端？云端旧数据将被覆盖。'))) return
    status('#cloud-status', '上传中…')
    const r = await window.api.cloudPush()
    status('#cloud-status', r.ok ? '上传完成 ✓' : `上传失败：${r.error}`, r.ok ? 'ok' : 'err')
  }
  btnPull.onclick = async () => {
    if (!(await showConfirm('恢复云端存档', '用云端存档覆盖本地？本地当前档案会自动备份（saves/profile.backup-*.json）。恢复后需要重启游戏生效。'))) return
    status('#cloud-status', '恢复中…')
    const r = await window.api.cloudPull()
    if (!r.ok) { status('#cloud-status', `恢复失败：${r.error}`, 'err'); return }
    status('#cloud-status', '恢复完成，建议重启游戏 ✓', 'ok')
  }

  // 修改密码
  btnPwChange.onclick = async () => {
    const old = cont.querySelector('#pw-old').value
    const nw = cont.querySelector('#pw-new').value
    const nw2 = cont.querySelector('#pw-new2').value
    if (!old) { status('#pw-status', '请输入原密码', 'err'); return }
    if (nw.length < 8 || !/[A-Za-z]/.test(nw) || !/\d/.test(nw)) {
      status('#pw-status', '新密码需不低于 8 位，且同时包含字母和数字', 'err'); return
    }
    if (nw !== nw2) { status('#pw-status', '两次输入的新密码不一致', 'err'); return }
    status('#pw-status', '修改中…')
    const r = await window.api.serverChangePassword({ oldPassword: old, newPassword: nw })
    if (!r.ok) { status('#pw-status', `修改失败：${r.error}`, 'err'); return }
    cont.querySelector('#pw-old').value = ''
    cont.querySelector('#pw-new').value = ''
    cont.querySelector('#pw-new2').value = ''
    status('#pw-status', '密码已修改 ✓（本机登录凭据已自动更新）', 'ok')
    playSfx('toggle')
  }

  // 登出
  btnLogout.onclick = async () => {
    if (!(await showConfirm('登出', '清除本机登录状态？下次启动游戏需重新登录。'))) return
    await window.api.serverLogout()
    renderAccountState(await window.api.serverStatus())
    status('#acc-status', '已登出 ✓', 'ok')
  }

  // 注销账号（永久删除）
  btnDel.onclick = async () => {
    const pass = delPass.value
    if (!pass) { status('#acc-status', '注销需输入账号密码确认', 'err'); return }
    const who = accState?.username ? `「${accState.username}」` : ''
    const ok = await showConfirm('注销账号', `将永久删除账号${who}及其云端存档，<b>不可恢复</b>。本地档案保留但不再同步。确定继续？`, { danger: true, okLabel: '永久删除' })
    if (!ok) return
    status('#acc-status', '注销中…')
    const r = await window.api.serverDeleteAccount({ password: pass })
    if (!r.ok) { status('#acc-status', `注销失败：${r.error}`, 'err'); return }
    delPass.value = ''
    renderAccountState(await window.api.serverStatus())
    status('#acc-status', '账号已注销（本机已退出登录）', 'ok')
  }

  // ── 版本与更新 ──
  const updResult = cont.querySelector('#upd-result')
  const updVer = cont.querySelector('#upd-ver')
  const updNotes = cont.querySelector('#upd-notes')
  const btnUpdOpen = cont.querySelector('#btn-upd-open')
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('zh-CN') } catch { return '' }
  }
  function renderUpdateResult(res) {
    if (!res?.ok || !res.latest) {
      updResult.style.display = 'none'
      btnUpdOpen.style.display = 'none'
      return
    }
    updVer.textContent = res.updateAvailable
      ? `发现新版本 v${res.latest.version}（发布于 ${fmtDate(res.latest.publishedAt)}）`
      : `已是最新版本（远程 v${res.latest.version}）`
    updNotes.textContent = (res.latest.notes || '').trim()
    updResult.style.display = ''
    btnUpdOpen.style.display = res.updateAvailable ? '' : 'none'
  }
  window.api?.appVersion?.().then((v) => {
    cont.querySelector('#upd-current').textContent = `v${v}`
  })
  renderUpdateResult(getLastCheck()) // 回显启动静默检查结果（含红点来源）
  cont.querySelector('#btn-upd-check').onclick = async () => {
    status('#upd-status', '正在检查更新…')
    const res = await checkUpdate()
    if (!res.ok) {
      status('#upd-status', `检查失败：${res.error}`, 'err')
      updResult.style.display = 'none'
      return
    }
    if (res.updateAvailable) {
      status('#upd-status', `发现新版本 v${res.latest.version}`, 'ok')
      playSfx('toggle')
    } else if (res.latest) {
      status('#upd-status', `已是最新版本 ✓`, 'ok')
    } else {
      status('#upd-status', '远程仓库暂无发布版', 'ok')
    }
    renderUpdateResult(res)
  }
  btnUpdOpen.onclick = () => window.api.openReleasePage()

  // ── 资源版本 ──
  const resVersionEl = cont.querySelector('#res-version')
  function renderResInfo(info) {
    if (!info?.ok) { resVersionEl.textContent = '资源不完整'; return }
    const src = info.source === 'overlay' ? '服务器更新' : info.source === 'base' ? '安装基线' : info.source
    resVersionEl.textContent = `v${info.version}（${src}）`
  }
  let currentResInfo = null
  window.api?.resourceInfo?.().then((info) => { currentResInfo = info; renderResInfo(info) })
  cont.querySelector('#btn-res-update').onclick = async () => {
    status('#res-status', '正在检查资源更新…')
    const r = await window.api.checkResourceUpdate(currentResInfo?.version || '0')
    if (!r.ok) { status('#res-status', r.disabled ? '未配置服务器，资源更新暂不可用' : `检查失败：${r.error}`, 'err'); return }
    if (!r.update) { status('#res-status', '资源已是最新 ✓', 'ok'); return }
    const n = Object.keys(r.update.changed || {}).length
    if (!(await showConfirm('资源更新', `发现资源更新 v${r.update.version}（增量下载 ${n} 个文件），下载并应用？`))) return
    status('#res-status', '下载资源中…')
    const applied = await window.api.applyResourceUpdate(r.update)
    if (!applied.ok) { status('#res-status', applied.error, 'err'); return }
    status('#res-status', `资源已更新到 v${applied.version} ✓（本次下载 ${applied.files} 个文件，重启后完全生效）`, 'ok')
    currentResInfo = await window.api.resourceInfo()
    renderResInfo(currentResInfo)
  }
  cont.querySelector('#btn-res-repair').onclick = async () => {
    if (!(await showConfirm('修复资源', '清除已下载的资源更新并回退到安装基线版本？不影响存档。', { danger: true }))) return
    status('#res-status', '修复中…')
    const info = await window.api.resourceRepair()
    currentResInfo = info
    renderResInfo(info)
    status('#res-status', info.ok ? '已回退到安装基线 ✓（重启后完全生效）' : '修复失败：资源目录不可用', info.ok ? 'ok' : 'err')
  }

  // ── 数据目录 ──
  const dataDirPath = cont.querySelector('#data-dir-path')
  const btnDataReset = cont.querySelector('#btn-data-dir-reset')
  function renderDataDir(st) {
    if (!st?.current) return
    dataDirPath.textContent = st.current + (st.isDefault ? '（默认）' : '（自定义）')
    dataDirPath.title = st.current
    btnDataReset.disabled = !!st.isDefault
  }
  window.api.getDataDir?.().then(renderDataDir)
  cont.querySelector('#btn-data-dir-choose').onclick = async () => {
    const res = await window.api.chooseDataDir()
    if (res.canceled) return
    if (!res.ok) {
      status('#data-dir-status', res.error, 'err')
      return
    }
    renderDataDir(res)
    status('#data-dir-status', '存档已迁移并切换目录（建议重启以完全生效）✓', 'ok')
    playSfx('toggle')
  }
  btnDataReset.onclick = async () => {
    const res = await window.api.resetDataDir()
    if (!res.ok) {
      status('#data-dir-status', res.error, 'err')
      return
    }
    renderDataDir(res)
    status('#data-dir-status', '已迁回默认位置（建议重启以完全生效）✓', 'ok')
    playSfx('toggle')
  }

  // ── AI配置保存与测试 ──
  const readAiForm = () => ({
    endpoint: cont.querySelector('#ai-endpoint').value.trim(),
    apiKey: cont.querySelector('#ai-key').value.trim(),
    model: cont.querySelector('#ai-model').value.trim()
  })
  cont.querySelector('#btn-ai-save').onclick = async () => {
    G.profile.ai = readAiForm()
    await saveProfile()
    status('#ai-status', '已保存 ✓', 'ok')
    setTimeout(() => status('#ai-status', ''), 1500)
  }
  cont.querySelector('#btn-ai-test').onclick = async () => {
    G.profile.ai = readAiForm()
    await saveProfile()
    status('#ai-status', '连接测试中…')
    const res = await aiChat([{ role: 'user', content: '回复"OK"两个字母即可。' }], 0)
    if (res.ok) status('#ai-status', `连接成功：${res.content.slice(0, 40)}`, 'ok')
    else status('#ai-status', `失败：${res.error}`, 'err')
  }

  // ── 自动协议方案池 ──
  const OPERATOR_NAMES = { baseline: '基准', offset: '偏移', overflow: '溢出', parity: '奇偶' }
  const WEAPON_NAMES = { standard: '标准协议骰组', heavy: '重核骰组', interferometer: '干涉仪骰组', ripple: '涟漪骰组' }

  function renderConfigView(cfg) {
    cfg = cfg || getActiveScheme()?.config || defaultAgentConfig()
    const view = cont.querySelector('#agent-config-view')
    const evRows = Object.entries(cfg.eventPriority).map(([id, r]) =>
      `<div class="cfg-row"><span class="k">${id}</span><span>选项优先 [${r.prefer.join(',')}]${r.minFlux != null ? ` · 需通量≥${r.minFlux}` : ''}${r.minHpPct != null ? ` · 需生命≥${Math.round(r.minHpPct * 100)}%` : ''}</span></div>`).join('')
    view.innerHTML = `
      <div class="cfg-section dim">开局：${OPERATOR_NAMES[cfg.opening?.operator] || cfg.opening?.operator || '基准'} + ${WEAPON_NAMES[cfg.opening?.weapon] || cfg.opening?.weapon || '标准协议骰组'}</div>
      <div class="cfg-section dim">事件优先级</div>${evRows}
      <div class="cfg-section dim">商店：生命&lt;${Math.round(cfg.shop.healBelowPct * 100)}%先恢复 · 保留通量${cfg.shop.keepFlux}${cfg.shop.buyPoolExpand ? ' · 买扩容' : ''}${cfg.shop.buyDicePack ? ' · 买礼包' : ''}</div>
      <div class="cfg-section dim">购买顺序：${cfg.shop.buyPriorities.join(' → ')}</div>
      <div class="cfg-section dim">奖励关：[${cfg.rewardPriority.prefer.join(',')}]${cfg.rewardPriority.healBelowPct ? ` · 生命&lt;${Math.round(cfg.rewardPriority.healBelowPct * 100)}%先治疗` : ''}</div>
      <div class="cfg-section dim">BOSS掉落：校验者[${cfg.bossLoot.verifier.join(',')}] 递归体[${cfg.bossLoot.recursion.join(',')}] 空引用[${cfg.bossLoot.nullref.join(',')}]</div>
      <div class="cfg-section dim">核心放置：${cfg.corePriority.join(' → ')}</div>`
  }

  // 方案列表（含激活/重命名/删除操作）
  function renderSchemeList() {
    const listEl = cont.querySelector('#scheme-list')
    listEl.innerHTML = ''
    for (const sch of getSchemes()) {
      const isActive = sch.id === G.profile.activeSchemeId
      const row = el(`
      <div class="scheme-row ${isActive ? 'active' : ''}" data-id="${sch.id}">
        <span class="scheme-name" title="点击${isActive ? '收起' : '激活'}该方案">${isActive ? '● ' : ''}${sch.name}</span>
        <span class="scheme-ops">
          <button class="btn btn-mini" data-op="rename" title="重命名">✎</button>
          <button class="btn btn-mini" data-op="copy" title="复制为新方案">⧉</button>
          <button class="btn btn-mini btn-warn" data-op="del" title="删除">✕</button>
        </span>
      </div>`)
      row.querySelector('.scheme-name').onclick = async () => {
        if (!isActive) {
          await activateScheme(sch.id)
          playSfx('toggle')
          status('#agent-status', `已切换方案：${sch.name} ✓`, 'ok')
          renderSchemeList()
          renderConfigView()
        }
      }
      row.querySelectorAll('button').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation()
          const op = b.dataset.op
          if (op === 'rename') {
            const name = prompt('方案名称：', sch.name)
            if (name && name.trim()) {
              await renameScheme(sch.id, name.trim())
              status('#agent-status', '已重命名 ✓', 'ok')
              renderSchemeList()
            }
          } else if (op === 'copy') {
            const c = await createScheme(`${sch.name} 副本`, sch.config)
            status('#agent-status', `已复制为：${c.name} ✓`, 'ok')
            renderSchemeList()
          } else if (op === 'del') {
            if (await showConfirm('删除方案', `确定删除方案「${sch.name}」？`)) {
              await deleteScheme(sch.id)
              status('#agent-status', '已删除 ✓', 'ok')
              renderSchemeList()
              renderConfigView()
            }
          }
        }
      })
      listEl.appendChild(row)
    }
  }
  renderSchemeList()
  renderConfigView()

  // 新建（手动=复制默认）
  cont.querySelector('#btn-scheme-new').onclick = async () => {
    const name = prompt('方案名称：', '新方案')
    if (!name || !name.trim()) return
    await createScheme(name.trim(), defaultAgentConfig())
    status('#agent-status', `已新建方案：${name.trim()}（默认配置，可用AI调整）✓`, 'ok')
    renderSchemeList()
  }

  // AI 新建（AI命名+AI配置）
  cont.querySelector('#btn-scheme-ai-new').onclick = async () => {
    const pref = cont.querySelector('#agent-pref').value
    status('#agent-status', 'AI新建方案中…（最长60秒）')
    const res = await generateAgentConfig(pref)
    if (!res.ok) { status('#agent-status', `新建失败：${res.error}`, 'err'); return }
    const sch = await createScheme(res.name || 'AI方案', res.config)
    status('#agent-status', `AI已创建方案「${sch.name}」（非法项已回落默认）✓`, 'ok')
    renderSchemeList()
  }

  // AI 调整当前方案
  cont.querySelector('#btn-scheme-ai-adjust').onclick = async () => {
    const cur = getActiveScheme()
    if (!cur) return
    const pref = cont.querySelector('#agent-pref').value
    status('#agent-status', `AI调整方案「${cur.name}」中…（最长60秒）`)
    const res = await generateAgentConfig(pref, cur.config)
    if (!res.ok) { status('#agent-status', `调整失败：${res.error}`, 'err'); return }
    await updateScheme(cur.id, { name: res.name || cur.name, config: res.config })
    status('#agent-status', `方案「${res.name || cur.name}」已更新（非法项已回落默认）✓`, 'ok')
    renderSchemeList()
    renderConfigView()
  }

  // ── 进化模式 ──
  const evoEnabled = cont.querySelector('#evo-enabled')
  const evoSwitchText = evoEnabled.closest('.set-switch').querySelector('.set-switch-text')
  evoEnabled.onchange = async () => {
    G.profile.evolution = evoEnabled.checked
    evoSwitchText.textContent = evoEnabled.checked ? '已开启' : '已关闭'
    playSfx('toggle')
    await saveProfile()
  }

  // ── 小窗模式风格 ──
  cont.querySelectorAll('.ms-opt').forEach((opt) => {
    opt.onclick = async () => {
      G.profile.miniStyle = opt.dataset.style === 'pet' ? 'pet' : 'hub'
      playSfx('toggle')
      await saveProfile()
      cont.querySelectorAll('.ms-opt').forEach((o) => o.classList.toggle('active', o === opt))
    }
  })

  // ── 声音设置 ──
  const sndEnabled = cont.querySelector('#snd-enabled')
  const sndVolume = cont.querySelector('#snd-volume')
  const sndVolText = cont.querySelector('#snd-vol-text')
  // 必须限定在声音开关自身内部取文字节点：容器里有多个 .set-switch-text（进化模式在前），
  // 直接全局 querySelector 会取到进化模式的文字，导致声音开关文字不随状态更新
  const sndSwitchText = sndEnabled.closest('.set-switch').querySelector('.set-switch-text')
  sndEnabled.onchange = async () => {
    G.profile.sound.enabled = sndEnabled.checked
    setSfxEnabled(sndEnabled.checked)
    sndSwitchText.textContent = sndEnabled.checked ? '已开启' : '已关闭'
    if (sndEnabled.checked) playSfx('toggle')
    await saveProfile()
  }
  sndVolume.oninput = () => {
    sndVolText.textContent = `${sndVolume.value}%`
    setSfxVolume(sndVolume.value / 100)
  }
  sndVolume.onchange = async () => {
    G.profile.sound.volume = sndVolume.value / 100
    playSfx('click')
    await saveProfile()
  }
  cont.querySelector('#btn-snd-test').onclick = () => {
    playSfx('victory')
  }

  // ── 退出终端（确认弹窗）与返回 ──
  cont.querySelector('#btn-exit').onclick = async () => {
    if (await showConfirm('退出终端', '确定退出变量协议？进行中的对局已自动保存。', { danger: true, okLabel: '退出' })) {
      window.close()
    }
  }
  // 返回：局内（行动线）进入则回到行动线，否则回主菜单
  cont.querySelector('#btn-back').onclick = () => show(params?.from === 'map' ? 'map' : 'menu')
}
