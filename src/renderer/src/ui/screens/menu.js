// 主菜单（明日方舟式布局：左侧桌宠立绘 + 右侧阶梯块状按钮群 + 顶部资源胶囊条，跟随鼠标轻微晃动）
import { show, registerScreen, onScreenCleanup } from '../../router.js'
import { G, loadRun, hasRunSave, decayPetSatiety } from '../../state.js'
import { activePet, chibiFor, computePetState, setPetFlash, petQuote, PET_STATE_NAMES } from '../../data/pets.js'
import { el, fmt } from '../components.js'
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
  { id: 'btn-settings', label: '系统设置', cls: 'mk-c' },
  { id: 'btn-quit', label: '退出终端', cls: 'btn-ghost mk-d' }
]

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

    <header class="menu-head">
      <div class="menu-deco" id="menu-deco">// SIGNAL LAB · PROTOCOL TERMINAL</div>
      <h1 class="menu-title">VARIABLE<span class="menu-x">_</span>PROTOCOL</h1>
      <div class="menu-sub">变 量 协 议</div>
      <div class="menu-tagline">肉鸽无限流 · 回合制骰子决斗</div>
    </header>

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
            ${it.id === 'btn-settings' && hasUpdate() ? '<i class="menu-btn-dot" title="发现新版本"></i>' : ''}
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
  cont.querySelector('#btn-settings').onclick = () => show('settings')
  cont.querySelector('#btn-quit').onclick = () => window.close()

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
