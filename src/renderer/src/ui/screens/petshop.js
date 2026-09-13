// 桌宠终端：购买桌宠 / 购买生态口粮 / 喂食 / 装备展示（局外算力币消费）
import { show, registerScreen } from '../../router.js'
import { G, saveProfile, decayPetSatiety } from '../../state.js'
import {
  PET_DEFS, activePet, petSatiety, chibiFor, computePetState, PET_STATE_NAMES,
  FOOD_PRICE, FOOD_BUNDLE, FOOD_BUNDLE_PRICE, FOOD_SATIETY, SATIETY_DECAY_MINUTES
} from '../../data/pets.js'
import { el, fmt } from '../components.js'
import { playSfx } from '../../core/sfx.js'

export function register() {
  registerScreen('petshop', renderPetShop)
}

function renderPetShop(root) {
  decayPetSatiety()
  const prof = G.profile
  const pet = prof.pet
  const act = activePet(prof)
  const actSat = act ? petSatiety(prof, act.id) : 0

  const cont = el(`
  <div class="screen screen-petshop">
    <div class="ps-head">
      <div class="crumb">// TERMINAL · 桌宠终端</div>
      <h2>PET LAB</h2>
      <div class="ps-coins">⌾ <b>${fmt(prof.coins)}</b><span class="unit">算力币</span></div>
    </div>
    <div class="ps-body">
      <div class="ps-col panel">
        <div class="set-title">// 桌宠图鉴</div>
        <div class="ps-list" id="ps-list"></div>
      </div>
      <div class="ps-col panel">
        <div class="set-title">// 生态口粮</div>
        <div class="ps-food-panel">
          <div class="ps-food-stock">库存 <b id="food-stock">${pet.food}</b> 份</div>
          <div class="ps-food-btns">
            <button class="btn ps-food" id="btn-food-1">购买 ×1 · ${FOOD_PRICE}币</button>
            <button class="btn ps-food" id="btn-food-5">购买 ×${FOOD_BUNDLE} · ${FOOD_BUNDLE_PRICE}币</button>
          </div>
          <div class="ps-note dim">每份口粮恢复 ${FOOD_SATIETY} 点饱食度。饱食度随现实时间缓慢下降（每${SATIETY_DECAY_MINUTES}分钟 -1），过低时桌宠会提醒你喂食。</div>
        </div>
        <div class="set-title" style="margin-top:18px">// 当前桌宠</div>
        <div class="ps-active" id="ps-active"></div>
      </div>
    </div>
    <div class="settings-foot">
      <button class="btn btn-primary" id="btn-back">返回</button>
    </div>
  </div>`)
  root.appendChild(cont)

  // ── 桌宠列表 ──
  const listEl = cont.querySelector('#ps-list')
  for (const def of PET_DEFS) {
    const owned = !!pet.owned[def.id]
    const equipped = pet.active === def.id
    const card = el(`
    <div class="ps-item ${equipped ? 'equipped' : ''}">
      <div class="ps-item-img"><img src="${def.fullImg}" alt="${def.name}"/></div>
      <div class="ps-item-info">
        <div class="ps-item-name">${def.name}<span class="dim"> · ${def.title}</span></div>
        <div class="ps-item-desc dim">${def.desc}</div>
        <div class="ps-item-foot">
          <span class="ps-price">${owned ? '<span class="ok">已拥有</span>' : `⌾ ${fmt(def.price)} 算力币`}</span>
          <button class="btn btn-mini ${owned ? '' : 'btn-primary'}" data-act="${owned ? 'equip' : 'buy'}" data-id="${def.id}" ${!owned && prof.coins < def.price ? 'disabled' : ''}>
            ${owned ? (equipped ? '当前展示中' : '设为展示') : (prof.coins < def.price ? '算力币不足' : '购买')}
          </button>
        </div>
      </div>
    </div>`)
    card.querySelector('button').onclick = async (e) => {
      const action = e.target.dataset.act
      if (action === 'buy') {
        if (prof.coins < def.price) { playSfx('error'); return }
        prof.coins -= def.price
        pet.owned[def.id] = true
        if (!pet.active) pet.active = def.id
        pet.satiety[def.id] = pet.satiety[def.id] ?? 50
        playSfx('buy')
        await saveProfile()
        show('petshop')
      } else if (action === 'equip') {
        pet.active = equipped ? null : def.id
        playSfx('toggle')
        await saveProfile()
        show('petshop')
      }
    }
    listEl.appendChild(card)
  }

  // ── 当前桌宠状态 ──
  const actEl = cont.querySelector('#ps-active')
  if (!act) {
    actEl.innerHTML = '<div class="dim">尚未装备桌宠。购买后在左侧设为展示，即可在小窗模式陪伴你。</div>'
  } else {
    const hungry = actSat <= 15
    const state = computePetState(prof, 'petshop')
    actEl.innerHTML = `
    <div class="ps-active-card ${hungry ? 'hungry' : ''}">
      <div class="ps-active-img" title="${PET_STATE_NAMES[state] || ''}"><img src="${chibiFor(act, state)}" alt="${act.name}"/></div>
      <div class="ps-active-info">
        <div class="ps-active-name">${act.name} <span class="dim">· ${act.title} · ${PET_STATE_NAMES[state] || ''}</span>${hungry ? '<span class="ps-hungry-tag">饿了</span>' : ''}</div>
        <div class="ps-sat-bar"><div class="ps-sat-fill" style="width:${Math.min(100, actSat)}%"></div></div>
        <div class="ps-sat-text dim">饱食度 ${Math.min(100, actSat)} / 100</div>
        <button class="btn btn-mini ps-food" id="btn-feed" ${pet.food <= 0 || actSat >= 100 ? 'disabled' : ''}>
          ${actSat >= 100 ? '已经吃饱啦' : pet.food <= 0 ? '口粮不足' : `喂食 · 消耗1份口粮（+${FOOD_SATIETY}饱食度）`}
        </button>
      </div>
    </div>`
    const feedBtn = actEl.querySelector('#btn-feed')
    feedBtn.onclick = async () => {
      const cur = petSatiety(prof, act.id)
      if (pet.food <= 0 || cur >= 100) { playSfx('error'); return }
      pet.food -= 1
      pet.satiety[act.id] = Math.min(100, cur + FOOD_SATIETY)
      playSfx('eat')
      await saveProfile()
      show('petshop')
    }
  }

  // ── 购买口粮 ──
  const buyFood = async (n, price) => {
    if (prof.coins < price) { playSfx('error'); return }
    prof.coins -= price
    pet.food += n
    playSfx('buy')
    await saveProfile()
    show('petshop')
  }
  cont.querySelector('#btn-food-1').onclick = () => buyFood(1, FOOD_PRICE)
  cont.querySelector('#btn-food-5').onclick = () => buyFood(FOOD_BUNDLE, FOOD_BUNDLE_PRICE)

  cont.querySelector('#btn-back').onclick = () => show('menu')
}
