// Three.js 骰子池渲染：按点数分组排列、暗态显示、轮盘式掷骰动画
// 每种骰子使用专属3D造型（render/diceModels.js），点数以悬浮徽章呈现
import * as THREE from 'three'
import { buildDieModel, dieColor } from './diceModels.js'

export class DicePoolView {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
    this.camera.position.set(0, 4.2, 10.5)
    this.camera.lookAt(0, 0, 0)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(3, 6, 5)
    this.scene.add(dir)
    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.models = []
    this._raf = null
    this._disposed = false
    this._raycaster = new THREE.Raycaster()
    this._pointer = new THREE.Vector2()
    // 点击骰子回调：onDieClick(die, clientX, clientY)
    // 悬停骰子回调：onDieHover(die, clientX, clientY)；die 为 null 表示移出
    this.onDieClick = null
    this.onDieHover = null
    const raycastAt = (e) => {
      const rect = canvas.getBoundingClientRect()
      this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this._raycaster.setFromCamera(this._pointer, this.camera)
      // 模型为 Group（含子 mesh），递归检测后向上找到挂载 die 数据的祖先
      const hits = this._raycaster.intersectObjects(this.group.children, true)
      for (const h of hits) {
        let o = h.object
        while (o && !o.userData?.die) o = o.parent
        if (o?.userData?.die) return o.userData.die
      }
      return null
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.onDieClick || this._disposed) return
      const die = raycastAt(e)
      if (die) this.onDieClick(die, e.clientX, e.clientY)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this.onDieHover || this._disposed) return
      this.onDieHover(raycastAt(e), e.clientX, e.clientY)
    })
    canvas.addEventListener('pointerleave', () => {
      if (!this.onDieHover || this._disposed) return
      this.onDieHover(null, 0, 0)
    })
    this._animate()
  }

  _animate() {
    if (this._disposed) return
    this._raf = requestAnimationFrame(() => this._animate())
    const t = performance.now() / 1000
    for (const m of this.models) {
      const u = m.userData
      if (u.spinning) {
        m.rotation.x += 0.15
        m.rotation.y += 0.22
      } else {
        m.rotation.y = u.baseRotY + Math.sin(t * 1.2 + u.phase) * 0.06
        m.rotation.x = u.baseRotX
      }
      const target = u.lit ? 1.18 : 1.0
      m.scale.lerp(new THREE.Vector3(target, target, target), 0.18)
    }
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const w = this.canvas.clientWidth || 300
    const h = this.canvas.clientHeight || 150
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // 重建骰池：相同点数相邻，按点数升序排列（从左到右、从上到下）
  setPool(dice) {
    this._disposeModels()
    this.resize()
    if (!dice || dice.length === 0) return
    const sorted = [...dice].sort((a, b) => a.pips - b.pips)
    const cols = Math.min(6, sorted.length)
    const rows = Math.ceil(sorted.length / cols)
    const cellX = 1.45, cellY = 1.5
    sorted.forEach((die, i) => {
      const col = i % cols, row = Math.floor(i / cols)
      const x = (col - (cols - 1) / 2) * cellX
      const y = ((rows - 1) / 2 - row) * cellY
      // 专属造型模型（Group：主mesh + 点数徽章sprite）
      const model = buildDieModel(die)
      model.position.set(x, y, 0)
      model.userData = {
        ...model.userData,
        uid: die.uid, die, lit: false, spinning: false,
        mainMesh: model.getObjectByName('main'),
        baseColor: new THREE.Color(dieColor(die)),
        baseRotY: (Math.random() - 0.5) * 0.25,
        baseRotX: (Math.random() - 0.5) * 0.15,
        phase: Math.random() * Math.PI * 2
      }
      model.rotation.y = model.userData.baseRotY
      this._applyLit(model, false)
      this.group.add(model)
      this.models.push(model)
    })
  }

  // 亮度应用：主mesh材质明暗 + 徽章微光
  _applyLit(model, lit) {
    const u = model.userData
    u.lit = lit
    const main = u.mainMesh
    if (main?.material) {
      const c = u.baseColor
      main.material.color.copy(lit ? c : c.clone().multiplyScalar(0.38))
      main.material.emissive = lit ? c.clone().multiplyScalar(0.3) : c.clone().multiplyScalar(0.12)
    }
  }

  _setLit(model, lit) {
    if (model) this._applyLit(model, lit)
  }

  // 轮盘式掷骰动画：从左到右依次点亮，最终停在结果骰子上
  async rollSweep(resultUid) {
    const ms = this.models
    if (ms.length === 0) return
    const idx = ms.findIndex((m) => m.userData.uid === resultUid)
    const target = idx >= 0 ? idx : ms.length - 1
    for (const m of ms) { this._setLit(m, false); m.userData.spinning = false }
    // 先快速掠过全部，再减速停在目标
    const path = []
    for (let i = 0; i < ms.length; i++) path.push(i)
    for (let i = 0; i <= target; i++) path.push(i)
    const total = path.length
    let prev = null
    for (let step = 0; step < total; step++) {
      const i = path[step]
      if (prev != null && prev !== i) this._setLit(ms[prev], false)
      this._setLit(ms[i], true)
      ms[i].userData.spinning = true
      if (prev != null && prev !== i) ms[prev].userData.spinning = false
      prev = i
      // 减速节奏
      const p = step / total
      await sleep(40 + p * p * 160)
    }
    if (prev != null) ms[prev].userData.spinning = false
    await sleep(220)
  }

  // 高亮结果骰子（不播动画）
  highlight(resultUid) {
    for (const m of this.models) {
      this._setLit(m, m.userData.uid === resultUid)
    }
  }

  _disposeModels() {
    for (const m of this.models) {
      this.group.remove(m)
      m.traverse((o) => {
        o.geometry?.dispose?.()
        if (o.material) {
          o.material.map?.dispose?.()
          o.material.dispose()
        }
      })
    }
    this.models = []
  }

  dispose() {
    this._disposed = true
    if (this._raf) cancelAnimationFrame(this._raf)
    this._disposeModels()
    this.renderer.dispose()
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
