// 主菜单（明日方舟式布局：左侧桌宠立绘 + 右侧阶梯块状按钮群 + 顶部资源胶囊条，跟随鼠标轻微晃动）
// v2.1.0：左上角不再展示游戏名称，改为「设置」「公告」入口（公告自动从服务器读取，
// 有未读自动弹窗）；导航区「系统设置」改为「行动档案」（成就系统，占位）、「退出终端」
// 迁入设置界面，原位改为彩蛋按钮「啥也没有」。
// v2.2.0：公告分类展示（系统通知/游戏公告），公告旁新增「邮件」入口（可含附件：
// 算力币/口粮/桌宠，服务端标记领取状态防重复发放，入账写入本地档案）。
import { show, registerScreen, onScreenCleanup } from '../../router.js'
import { G, loadRun, hasRunSave, decayPetSatiety, saveProfile } from '../../state.js'
import { activePet, chibiFor, computePetState, setPetFlash, petQuote, PET_STATE_NAMES, petOf } from '../../data/pets.js'
import { el, fmt, showDialog } from '../components.js'
import { playSfx } from '../../core/sfx.js'
import { hasUpdate } from '../../core/updater.js'

export function register() {
  registerScreen('menu', renderMenu)
}

// 右侧导航按钮（cls 可选附加样式；mk-* 控制明日方舟式阶梯布局位）
const NAV_ITEMS = [
  { id: 'btn-new', label: '新的一局', cls: 'btn-primary mk-hero' },
  { id: 'btn-continue', label: '继续行动', cls: 'mk-wide' },
  { id: 'btn-pet', label: '桌宠终端', cls: 'mk-a' },
  { id: 'btn-codex', label: '档案图鉴', cls: 'mk-b' },
  { id: 'btn-archive', label: '行动档案', cls: 'mk-c' },
  { id: 'btn-nothing', label: '啥也没有', cls: 'btn-ghost mk-d' }
]

// ── 公告（服务器拉取，短缓存；分类：system 系统通知 / game 游戏公告；已读 id 记录在玩家档案）──
let annCache = null       // { list, at }
const ANN_TTL = 60000

async function fetchAnnouncements(force = false) {
  if (!force && annCache && Date.now() - annCache.at < ANN_TTL) return annCache.list
  const r = await window.api?.serverAnnouncements?.()
  annCache = { list: r?.ok ? (r.announcements || []) : [], at: Date.now() }
  return annCache.list
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 公告分类定义（tab 顺序即展示顺序）
const ANN_CATS = [
  { id: 'system', label: '系统通知' },
  { id: 'game', label: '游戏公告' }
]

function annDialogHtml(list, activeCat) {
  const tabs = ANN_CATS.map((c) =>
    `<button class="ann-tab${c.id === activeCat ? ' active' : ''}" data-cat="${c.id}">// ${c.label}</button>`
  ).join('')
  const body = annListHtml(list, activeCat)
  return `<div class="ann-tabs">${tabs}</div><div class="ann-list" id="ann-list-body">${body}</div>`
}

function annListHtml(list, cat) {
  const items = list.filter((a) => (a.category === 'game' ? 'game' : 'system') === cat)
  if (!items.length) return '<div class="ann-empty dim">暂无公告</div>'
  return items.map((a) => {
    const date = a.date ? new Date(a.date).toLocaleDateString('zh-CN') : ''
    return `
    <div class="ann-item">
      <div class="ann-item-head">
        <span class="ann-item-title">${esc(a.title)}</span>
        <span class="ann-item-date dim">${date}</span>
      </div>
      <div class="ann-item-content">${esc(a.content)}</div>
    </div>`
  }).join('')
}

// 最新打开的弹窗（showDialog 同步注入 DOM，调用返回后即可查询绑定）
function lastOverlay() {
  const all = document.querySelectorAll('.dlg-overlay')
  return all[all.length - 1] || null
}

async function showAnnouncements(auto = false) {
  const list = await fetchAnnouncements()
  // 默认选中含未读更多的分类（自动弹窗场景）；默认系统通知
  const read = new Set(G.profile.annRead || [])
  const unreadOf = (cat) => list.filter((a) => (a.category === 'game' ? 'game' : 'system') === cat && a.id && !read.has(Number(a.id))).length
  const activeCat = unreadOf('game') > unreadOf('system') ? 'game' : 'system'
  // showDialog 同步注入 DOM：先拿到关闭 Promise，绑定 tab 事件后再等待关闭
  const closed = showDialog({
    title: '// 公告',
    html: annDialogHtml(list, activeCat),
    width: 560,
    buttons: [{ label: '知道了', value: true, cls: 'btn-primary' }]
  })
  const overlay = lastOverlay()
  if (overlay) {
    const listBody = overlay.querySelector('#ann-list-body')
    overlay.querySelectorAll('.ann-tab').forEach((tab) => {
      tab.onclick = () => {
        overlay.querySelectorAll('.ann-tab').forEach((t) => t.classList.toggle('active', t === tab))
        if (listBody) listBody.innerHTML = annListHtml(list, tab.dataset.cat)
      }
    })
  }
  await closed
  // 关闭即视为全部已读（无论手动还是自动弹出）
  let changed = false
  for (const a of list) {
    const id = Number(a.id)
    if (id && !read.has(id)) { read.add(id); changed = true }
  }
  if (changed) {
    // 只保留最近 50 条已读记录，防止档案无限膨胀
    G.profile.annRead = [...read].slice(-50)
    await saveProfile()
  }
  if (auto) return
  // 手动查看后刷新红点状态
  const dot = document.querySelector('#menu-ann-dot')
  if (dot) dot.style.display = 'none'
}

// ── 邮件（登录后从服务器拉取；附件领取状态以服务端为准，防重复发放）──
let mailCache = null      // { mails, at }
const MAIL_TTL = 60000

async function fetchMails(force = false) {
  if (!force && mailCache && Date.now() - mailCache.at < MAIL_TTL) return mailCache.mails
  const r = await window.api?.serverMails?.()
  mailCache = { mails: r?.ok ? (r.mails || []) : [], at: Date.now() }
  return mailCache.mails
}

// 附件展示文本（与服务器 admin CLI 的 fmtAttach 口径一致）
function attachText(a) {
  if (a.type === 'coins') return `算力币 ×${a.amount}`
  if (a.type === 'food') return `生态口粮 ×${a.amount}`
  if (a.type === 'pet') return `桌宠 · ${petOf(a.id)?.name || a.id}`
  return `道具 ${a.type}`
}

function mailListHtml(mails) {
  if (!mails.length) return '<div class="ann-empty dim">暂无邮件（登录后可收取）</div>'
  return mails.map((m) => {
    const date = m.date ? new Date(m.date).toLocaleDateString('zh-CN') : ''
    const hasAtt = (m.attachments || []).length > 0
    return `
    <div class="mail-item${m.claimed ? ' claimed' : ''}" data-id="${m.id}">
      <div class="mail-item-head">
        <span class="mail-item-title">${esc(m.title)}</span>
        ${hasAtt && !m.claimed ? '<span class="mail-tag">有附件</span>' : ''}
        ${m.claimed ? '<span class="mail-tag ok">已领取</span>' : ''}
        <span class="ann-item-date dim">${date}</span>
      </div>
      <div class="mail-item-meta dim">发件人：${esc(m.from) || '未知'}${hasAtt ? ' · ' + m.attachments.map(attachText).join('、') : ''}</div>
    </div>`
  }).join('')
}

// 附件入账（coins→算力币 / food→口粮 / pet→桌宠仓库；未知类型跳过），返回入账描述
function grantAttachments(attachments) {
  const got = []
  const pet = G.profile.pet
  for (const a of attachments || []) {
    if (a.type === 'coins' && a.amount > 0) {
      G.profile.coins = Math.max(0, Math.floor(Number(G.profile.coins) || 0)) + Math.floor(a.amount)
      got.push(`算力币 ×${a.amount}`)
    } else if (a.type === 'food' && a.amount > 0) {
      pet.food = Math.max(0, Math.floor(Number(pet.food) || 0)) + Math.floor(a.amount)
      got.push(`生态口粮 ×${a.amount}`)
    } else if (a.type === 'pet' && a.id && petOf(a.id)) {
      pet.owned[a.id] = true
      got.push(`桌宠 · ${petOf(a.id).name}`)
    }
  }
  return got
}

function mailDetailHtml(m) {
  const date = m.date ? new Date(m.date).toLocaleString('zh-CN') : ''
  const atts = (m.attachments || []).length
    ? `<div class="mail-attachs">${m.attachments.map((a) => `<span class="mail-attach${m.claimed ? ' got' : ''}">${attachText(a)}</span>`).join('')}</div>`
    : ''
  return `
  <div class="mail-detail">
    <div class="mail-detail-meta dim">发件人：${esc(m.from) || '未知'} · ${date}</div>
    <div class="mail-detail-body">${esc(m.body)}</div>
    ${atts}
  </div>`
}

// 邮件详情弹窗：返回 true 表示发生了领取（供列表刷新）
async function showMailDetail(m) {
  const canClaim = (m.attachments || []).length > 0 && !m.claimed
  const buttons = canClaim
    ? [{ label: '领取附件', value: 'claim', cls: 'btn-primary' }, { label: '关闭', value: true, cls: '' }]
    : [{ label: '关闭', value: true, cls: 'btn-primary' }]
  const v = await showDialog({
    title: `// 邮件 · ${esc(m.title) || '无题'}`,
    html: mailDetailHtml(m),
    width: 520,
    buttons
  })
  if (v !== 'claim') return false
  const r = await window.api?.serverMailClaim?.(m.id)
  if (!r?.ok) {
    await showDialog({ title: '// 领取失败', html: `<div class="dlg-msg">${esc(r?.error || '网络异常，请稍后再试')}</div>` })
    return false
  }
  m.claimed = true
  const got = grantAttachments(r.attachments)
  await saveProfile()
  await showDialog({
    title: '// 领取成功',
    html: `<div class="dlg-msg">已领取：<b>${esc(got.join('、') || '（无可入账附件）')}</b></div>`
  })
  return true
}

async function showMails() {
  const mails = await fetchMails(true)
  // showDialog 同步注入 DOM：先拿到关闭 Promise，绑定邮件项事件后再等待关闭
  const closed = showDialog({
    title: '// 邮件',
    html: `<div class="mail-list" id="mail-list-body">${mailListHtml(mails)}</div>`,
    width: 560,
    buttons: [{ label: '关闭', value: true, cls: 'btn-primary' }]
  })
  const overlay = lastOverlay()
  if (overlay) {
    overlay.querySelectorAll('.mail-item').forEach((item) => {
      item.onclick = async () => {
        const m = mails.find((x) => String(x.id) === String(item.dataset.id))
        if (!m) return
        const claimed = await showMailDetail(m)
        if (claimed) {
          // 同步列表项状态与红点
          item.classList.add('claimed')
          item.querySelectorAll('.mail-tag').forEach((t) => t.remove())
          const head = item.querySelector('.mail-item-head')
          if (head) head.insertAdjacentHTML('beforeend', '<span class="mail-tag ok">已领取</span>')
          refreshMailDot()
        }
      }
    })
  }
  await closed
  refreshMailDot()
}

// 邮件红点：存在未领取附件的邮件时点亮
async function refreshMailDot() {
  const dot = document.querySelector('#menu-mail-dot')
  if (!dot) return
  const mails = await fetchMails()
  dot.style.display = mails.some((m) => (m.attachments || []).length > 0 && !m.claimed) ? '' : 'none'
}

function renderMenu(root) {
  decayPetSatiety()
  const best = G.profile.bestLayer || 0
  const runs = G.profile.totalRuns || 0
  const kills = G.profile.totalKills || 0
  const coins = G.profile.coins || 0
  const pet = activePet(G.profile)
  const state = pet ? computePetState(G.profile, 'menu') : 'normal'
  const stateName = PET_STATE_NAMES[state] || ''
  // 饥饿/哭泣/晕倒时名牌警示
  const petWarn = ['hunger', 'cry', 'dizziness'].includes(state)
  const artSrc = pet ? (pet.fullImg || pet.chibiImg) : ''

  const cont = el(`
  <div class="screen screen-menu">
    <div class="menu-vline"></div>

    <div class="menu-head">
      <div class="menu-deco" id="menu-deco">// SIGNAL LAB · PROTOCOL TERMINAL</div>
      <div class="menu-corner">
        <button class="menu-corner-btn" id="menu-btn-settings" title="系统设置">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.6 1.6M10.9 10.9l1.6 1.6M12.5 3.5l-1.6 1.6M5.1 10.9l-1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span>设置</span>
          <i class="menu-corner-dot" id="menu-set-dot" style="${hasUpdate() ? '' : 'display:none'}" title="发现新版本"></i>
        </button>
        <button class="menu-corner-btn" id="menu-btn-ann" title="公告">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 4.5h8v7h-8z M10.5 6.5l3-1.5v6l-3-1.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          </svg>
          <span>公告</span>
          <i class="menu-corner-dot" id="menu-ann-dot" style="display:none" title="有未读公告"></i>
        </button>
        <button class="menu-corner-btn" id="menu-btn-mail" title="邮件">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 4.5h12v7.5H2z M2 4.8l6 4.2 6-4.2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          </svg>
          <span>邮件</span>
          <i class="menu-corner-dot" id="menu-mail-dot" style="display:none" title="有可领取附件"></i>
        </button>
      </div>
    </div>

    <div class="menu-artzone">
      ${pet ? `
      <div class="menu-art-par" id="menu-art-par">
        <div class="menu-art-glow"></div>
        <img class="menu-art" id="menu-art" src="${artSrc}" alt="${pet.name}"
             title="桌宠 · ${pet.name}（${stateName}）" draggable="false"/>
        <div class="menu-art-tag${petWarn ? ' warn' : ''}">
          <img class="menu-art-ava" src="${chibiFor(pet, state)}" alt="" draggable="false"/>
          <div class="menu-art-info">
            <b>${pet.name}</b>
            <span>${pet.title || ''} · ${stateName}</span>
          </div>
        </div>
        <div class="menu-bubble" id="menu-bubble">
          <img src="${chibiFor(pet, 'tsundere')}" alt=""/>
          <span id="menu-bubble-text"></span>
        </div>
      </div>` : `
      <div class="menu-art-empty">// NO COMPANION SIGNAL<br/><span>接入「桌宠终端」以获取伙伴</span></div>`}
    </div>

    <div class="menu-topbar">
      <span class="menu-chip"><i>⌾</i><em>算力币</em><b>${fmt(coins)}</b></span>
      <span class="menu-chip"><i>▮</i><em>最高层数</em><b>${best}</b></span>
      <span class="menu-chip"><i>✦</i><em>出击</em><b>${runs}</b></span>
      <span class="menu-chip"><i>☠</i><em>清除</em><b>${kills}</b></span>
    </div>

    <nav class="menu-nav">
      <div class="menu-3dstack" id="menu-3dstack">
        ${(() => {
          const mk = (it, i) => `
          <button class="btn menu-btn ${it.cls || ''}" id="${it.id}" style="--i:${i}">
            <i class="menu-btn-idx">${String(i + 1).padStart(2, '0')}</i>
            <span class="menu-btn-txt">${it.label}</span>
            <i class="menu-btn-arrow">▸</i>
          </button>`
          return `
          ${mk(NAV_ITEMS[0], 0)}
          ${mk(NAV_ITEMS[1], 1)}
          <div class="menu-row">${mk(NAV_ITEMS[2], 2)}${mk(NAV_ITEMS[3], 3)}</div>
          <div class="menu-row">${mk(NAV_ITEMS[4], 4)}${mk(NAV_ITEMS[5], 5)}</div>`
        })()}
      </div>
    </nav>
  </div>`)
  root.appendChild(cont)

  // 版本号动态填充（打包版随应用版本走，避免硬编码遗漏）
  window.api?.appVersion?.().then((v) => {
    const deco = cont.querySelector('#menu-deco')
    if (deco) deco.textContent = `// SIGNAL LAB · PROTOCOL TERMINAL v${v}`
  })

  const btnContinue = cont.querySelector('#btn-continue')
  if (!hasRunSave()) btnContinue.disabled = true

  cont.querySelector('#btn-new').onclick = () => show('select')
  btnContinue.onclick = async () => {
    const ok = await loadRun()
    if (ok) show('map')
  }
  cont.querySelector('#btn-pet').onclick = () => show('petshop')
  cont.querySelector('#btn-codex').onclick = () => show('codex')

  // 行动档案（成就系统）：占位
  cont.querySelector('#btn-archive').onclick = () => {
    showDialog({
      title: '// 行动档案',
      html: '<div class="dlg-msg">行动档案（成就系统）制作中，敬请期待。</div>'
    })
  }

  // 彩蛋：都说了啥也没有
  cont.querySelector('#btn-nothing').onclick = () => {
    playSfx('click')
    showDialog({
      title: '// 提示',
      html: '<div class="dlg-msg">都说了啥也没有。</div>'
    })
  }

  // 左上角：设置 / 公告 / 邮件
  cont.querySelector('#menu-btn-settings').onclick = () => show('settings')
  cont.querySelector('#menu-btn-ann').onclick = () => showAnnouncements(false)
  cont.querySelector('#menu-btn-mail').onclick = () => showMails()

  // 公告：进入主菜单时拉取，有未读则自动弹窗并点亮红点
  ;(async () => {
    try {
      const list = await fetchAnnouncements()
      if (!list.length) return
      const read = new Set(G.profile.annRead || [])
      const unread = list.filter((a) => a.id && !read.has(Number(a.id)))
      const dot = cont.querySelector('#menu-ann-dot')
      if (unread.length) {
        if (dot) dot.style.display = ''
        await showAnnouncements(true)
      }
    } catch { /* 公告获取失败不影响主菜单 */ }
  })()

  // 邮件：登录状态下拉取，有未领取附件的邮件点亮红点（未登录/未配置静默跳过）
  ;(async () => {
    try {
      const st = await window.api?.serverStatus?.()
      if (!st?.loggedIn) return
      mailCache = null // 每次进入主菜单强制刷新邮件状态
      await refreshMailDot()
    } catch { /* 邮件获取失败不影响主菜单 */ }
  })()

  // ---- 3D侧向按钮栏：跟随鼠标轻微晃动（立绘反向视差） ----
  const stack = cont.querySelector('#menu-3dstack')
  const artPar = cont.querySelector('#menu-art-par')
  let raf = 0
  let nx = 0
  let ny = 0
  const apply = () => {
    raf = 0
    if (stack) stack.style.transform = `rotateY(${(-6 + nx * 5).toFixed(2)}deg) rotateX(${(1.5 - ny * 3.5).toFixed(2)}deg)`
    if (artPar) artPar.style.transform = `translate(${(nx * -18).toFixed(1)}px, ${(ny * -10).toFixed(1)}px)`
  }
  const onMove = (e) => {
    nx = e.clientX / window.innerWidth - 0.5
    ny = e.clientY / window.innerHeight - 0.5
    if (!raf) raf = requestAnimationFrame(apply)
  }
  window.addEventListener('mousemove', onMove)
  onScreenCleanup(() => {
    window.removeEventListener('mousemove', onMove)
    if (raf) cancelAnimationFrame(raf)
  })

  // 点击立绘：傲娇台词气泡（保留原有互动）
  const artEl = cont.querySelector('#menu-art')
  if (artEl) {
    let bubbleTimer = 0
    artEl.onclick = () => {
      setPetFlash('tsundere', 3000)
      playSfx('pet')
      const bubble = cont.querySelector('#menu-bubble')
      const text = cont.querySelector('#menu-bubble-text')
      if (!bubble || !text) return
      text.textContent = petQuote(pet, 'tsundere')
      bubble.classList.add('show')
      clearTimeout(bubbleTimer)
      bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 3200)
    }
  }
}
