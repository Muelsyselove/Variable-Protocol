// 骰子专属3D模型工厂：每种骰子独立造型（程序化几何，语义化设计）
// 战斗骰池（dice3d.js）与图鉴快照共用；点数以悬浮徽章呈现（billboard）
import * as THREE from 'three'
import { ALL_DICE } from '../data/diceDefs.js'

// 类型主色（沿用骰池配色体系）
const KIND_COLORS = {
  ATTACK: 0x3ee08f,
  BARRIER: 0x56c8e8,
  SHIELD: 0x7fd8ff,
  HEAL: 0xf0b34a,
  PSYCHIC: 0x9d8cff,
  PURE: 0x5d7385,
  PARALYZE: 0xa8e8f0,
  WEAKEN: 0x9a8fb8,
  EMPOWER: 0xf5d76e,
  DISPEL: 0xd8f0e8,
  COPY: 0xc0c8d8,
  ECON: 0xf7c873,
  DEFAULT: 0xc8d6e2
}

export function dieColor(die) {
  for (const k of ['PSYCHIC', 'HEAL', 'BARRIER', 'SHIELD', 'ATTACK']) {
    if (die.kinds?.includes(k)) return KIND_COLORS[k]
  }
  if (die.kinds?.includes('PURE')) return KIND_COLORS.PURE
  return KIND_COLORS.DEFAULT
}

// ── 材质 ──
function mat(color, { emissive = 0.12, rough = 0.4, metal = 0.35, flat = true } = {}) {
  const c = new THREE.Color(color)
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: c.clone().multiplyScalar(emissive),
    roughness: rough,
    metalness: metal,
    flatShading: flat
  })
}
function edgeMesh(geo, color, thickness = 0.05) {
  const e = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  )
  e.scale.setScalar(1 + thickness)
  return e
}

// ── 各骰子造型（语义化：形状对应其功能） ──
// 返回 Group（主 mesh 命名 main 供点亮/材质操作）
const BUILDERS = {
  // 攻击骰：尖锐八面体（锋利）
  attack(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.72)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.15 }))
    m.name = 'main'
    m.scale.set(1, 1.25, 1)
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 屏障骰：六角晶板（护盾）
  barrier(color) {
    const g = new THREE.Group()
    const geo = new THREE.CylinderGeometry(0.68, 0.68, 0.3, 6)
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.15, metal: 0.55 }))
    m.name = 'main'
    m.rotation.x = Math.PI / 2
    g.add(m)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color })
    )
    g.add(ring)
    return g
  },
  // 治疗骰：圆润十二面体
  heal(color) {
    const g = new THREE.Group()
    const geo = new THREE.DodecahedronGeometry(0.66)
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.25, metal: 0.2, flat: false }))
    m.name = 'main'
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 干涉骰：交叠双环（干涉条纹）
  interference(color) {
    const g = new THREE.Group()
    const t1 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 10, 32), mat(color, { emissive: 0.2 }))
    const t2 = t1.clone()
    t1.rotation.y = Math.PI / 3
    t2.rotation.y = -Math.PI / 3
    t1.name = 'main'
    g.add(t1, t2)
    return g
  },
  // 侵蚀骰：低分段破碎多面体（磨损）
  erosion(color) {
    const g = new THREE.Group()
    const geo = new THREE.IcosahedronGeometry(0.68, 0)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.05, rough: 0.8, metal: 0.15 }))
    m.name = 'main'
    m.scale.set(1.15, 0.85, 0.95)
    m.rotation.z = 0.3
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 校验骰：规整立方体+校验框（规则）
  verify(color) {
    const g = new THREE.Group()
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8)
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.3, metal: 0.5 }))
    m.name = 'main'
    g.add(m, edgeMesh(geo, color, 0.08))
    return g
  },
  // 强袭骰：细长矛头（突刺）
  assault(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.42, 1.35, 4)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.25, metal: 0.6 }))
    m.name = 'main'
    m.rotation.z = Math.PI / 4
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 重叠骰：错位交叠双八面体
  overlap(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.5)
    const a = new THREE.Mesh(geo, mat(color, { rough: 0.2, metal: 0.5, flat: false }))
    const b = a.clone()
    a.position.set(-0.22, 0.1, 0.1)
    b.position.set(0.22, -0.1, -0.1)
    a.name = 'main'
    g.add(a, b)
    return g
  },
  // 沉沦骰：倒垂水滴（下坠低沉）
  gloomDie(color) {
    const g = new THREE.Group()
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.85, 16), mat(color, { emissive: 0.1, flat: false }))
    cone.rotation.x = Math.PI
    cone.position.y = -0.12
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mat(color, { emissive: 0.1, flat: false }))
    ball.position.y = 0.32
    ball.name = 'main'
    g.add(ball, cone)
    return g
  },
  // 混沌骰：环结（纠缠混沌）
  chaosDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.TorusKnotGeometry(0.42, 0.14, 64, 10)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.2, flat: false }))
    m.name = 'main'
    g.add(m)
    return g
  },
  // 破灭骰：碎裂四面体簇
  ruinDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.TetrahedronGeometry(0.55)
    const main = new THREE.Mesh(geo, mat(color, { emissive: 0.15 }))
    main.name = 'main'
    g.add(main)
    // 散落碎片
    const frag = new THREE.Mesh(new THREE.TetrahedronGeometry(0.2), mat(color, { emissive: 0.1 }))
    frag.position.set(0.62, 0.3, 0.2)
    const frag2 = frag.clone()
    frag2.position.set(-0.55, -0.35, 0.15)
    frag2.scale.setScalar(0.8)
    const frag3 = frag.clone()
    frag3.position.set(0.3, -0.55, -0.2)
    frag3.scale.setScalar(0.6)
    g.add(frag, frag2, frag3)
    return g
  },
  // 过载骰：核心球+尖刺（爆发）
  overloadDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(color, { emissive: 0.35, flat: false }))
    core.name = 'main'
    g.add(core)
    const spikeGeo = new THREE.ConeGeometry(0.09, 0.42, 5)
    const dirs = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 1], [-1, -1, 1], [1, -1, -1], [-1, 1, -1]
    ]
    for (const [x, y, z] of dirs) {
      const s = new THREE.Mesh(spikeGeo, mat(color, { emissive: 0.3, metal: 0.6 }))
      const v = new THREE.Vector3(x, y, z).normalize()
      s.position.copy(v.clone().multiplyScalar(0.6))
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)
      g.add(s)
    }
    return g
  },
  // 净化骰：明亮核球+双光环（纯净）
  purify(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 20, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: new THREE.Color(color).multiplyScalar(0.5),
        roughness: 0.1, metalness: 0.1
      })
    )
    core.name = 'main'
    const halo1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.03, 8, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    )
    const halo2 = halo1.clone()
    halo2.scale.setScalar(0.8)
    halo1.rotation.x = Math.PI / 2.4
    halo2.rotation.x = Math.PI / 1.6
    g.add(core, halo1, halo2)
    return g
  },
  // 1点骰：最小立方体（纯点数）
  pure1(color) {
    const g = new THREE.Group()
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5)
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.5, metal: 0.3 }))
    m.name = 'main'
    g.add(m, edgeMesh(geo, color))
    return g
  },

  // ── 扩充骰子（41种） ──────────────────────────────────

  // 护盾骰：同心双层六角环
  shieldDie(color) {
    const g = new THREE.Group()
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.12, 8, 6), mat(color, { emissive: 0.2, metal: 0.5 }))
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.09, 8, 6), mat(color, { emissive: 0.15, metal: 0.5 }))
    inner.name = 'main'
    outer.rotation.z = Math.PI / 6
    g.add(inner, outer)
    return g
  },
  // 棱堡骰：六棱柱城垛+顶环
  bastionDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.62, 6), mat(color, { rough: 0.3, metal: 0.55 }))
    body.name = 'main'
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 6), mat(color, { emissive: 0.25 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.34
    g.add(body, ring)
    return g
  },
  // 修复骰：十二面体+十字刻槽
  repairDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62), mat(color, { rough: 0.25, flat: false }))
    body.name = 'main'
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.1), mat(color, { emissive: 0.4 }))
    const bar2 = bar1.clone()
    bar2.rotation.z = Math.PI / 2
    g.add(body, bar1, bar2)
    return g
  },
  // 再生骰：球体+上升螺旋环
  regenDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(color, { emissive: 0.15, flat: false }))
    core.name = 'main'
    g.add(core)
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.08, 0.035, 6, 24), mat(color, { emissive: 0.3 }))
      ring.position.y = -0.25 + i * 0.28
      ring.rotation.x = Math.PI / 2.6
      ring.rotation.z = i * 1.1
      g.add(ring)
    }
    return g
  },
  // 急救骰：圆球+对称翼片
  firstAidDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), mat(color, { emissive: 0.18, flat: false }))
    core.name = 'main'
    const finGeo = new THREE.BoxGeometry(0.7, 0.28, 0.06)
    const f1 = new THREE.Mesh(finGeo, mat(color, { emissive: 0.3, metal: 0.5 }))
    const f2 = f1.clone()
    f1.rotation.z = Math.PI / 3
    f2.rotation.z = -Math.PI / 3
    g.add(core, f1, f2)
    return g
  },
  // 哨岗骰：四面体塔台+底盘环
  sentryDie(color) {
    const g = new THREE.Group()
    const tower = new THREE.Mesh(new THREE.TetrahedronGeometry(0.62), mat(color, { emissive: 0.2, metal: 0.5 }))
    tower.name = 'main'
    tower.rotation.y = Math.PI / 4
    tower.position.y = 0.18
    const base = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 6), mat(color, { emissive: 0.25 }))
    base.rotation.x = Math.PI / 2
    base.position.y = -0.35
    g.add(tower, base)
    return g
  },
  // 法能骰：内凹二十面体+悬浮光点
  magicDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 0), mat(color, { emissive: 0.1, rough: 0.5 }))
    body.name = 'main'
    g.add(body, edgeMesh(body.geometry, color, 0.12))
    const dotGeo = new THREE.SphereGeometry(0.07, 8, 6)
    for (const p of [[0.72, 0.3, 0], [-0.6, -0.4, 0.45], [0.1, 0.66, -0.4], [0.2, -0.68, -0.35]]) {
      const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color }))
      d.position.set(...p)
      g.add(d)
    }
    return g
  },
  // 穿透骰：细长三棱箭簇
  pierceDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.34, 1.4, 3)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.28, metal: 0.6 }))
    m.name = 'main'
    m.rotation.z = Math.PI / 2.6
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 破甲骰：楔形劈砍体
  sunderDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.5, 1.1, 3)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.22, metal: 0.65, rough: 0.3 }))
    m.name = 'main'
    m.scale.set(1, 1, 0.45)
    m.rotation.z = Math.PI / 2.2
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 真伤骰：极简细长三角棱柱
  trueStrikeDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.22, 1.5, 3)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.4, metal: 0.7, rough: 0.2 }))
    m.name = 'main'
    m.rotation.z = Math.PI / 2.4
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 处决骰：双刃斧状八面体
  executeDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.68)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.25, metal: 0.6 }))
    m.name = 'main'
    m.scale.set(1.35, 0.55, 0.5)
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 链式骰：双小八面体短链相连
  chainDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.4)
    const a = new THREE.Mesh(geo, mat(color, { emissive: 0.2, metal: 0.55 }))
    const b = a.clone()
    a.position.set(-0.42, 0.1, 0)
    b.position.set(0.42, -0.1, 0)
    a.name = 'main'
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 6, 12), mat(color, { emissive: 0.3 }))
    link.rotation.y = Math.PI / 2
    g.add(a, b, link)
    return g
  },
  // 吸血骰：八面体外缠吸血管线
  leechDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat(color, { emissive: 0.2, rough: 0.5 }))
    core.name = 'main'
    g.add(core)
    const tubeMat = mat(0xc8506a, { emissive: 0.35 })
    for (let i = 0; i < 2; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.06, 0.05, 6, 20), tubeMat)
      t.rotation.x = Math.PI / 2 + i * 0.5
      t.rotation.z = i * 1.2
      g.add(t)
    }
    return g
  },
  // 尖峰骰：膨胀开裂八面体
  spikeDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat(color, { emissive: 0.3, rough: 0.6 }))
    core.name = 'main'
    g.add(core)
    const spikeGeo = new THREE.ConeGeometry(0.1, 0.45, 4)
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0.7, 0.7, 0], [-0.7, -0.7, 0]]) {
      const s = new THREE.Mesh(spikeGeo, mat(color, { emissive: 0.4, metal: 0.6 }))
      const v = new THREE.Vector3(x, y, z).normalize()
      s.position.copy(v.clone().multiplyScalar(0.7))
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)
      g.add(s)
    }
    return g
  },
  // 不稳骰：歪斜立方体+尖刺
  unstableDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.BoxGeometry(0.75, 0.75, 0.75)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.35, rough: 0.7 }))
    m.name = 'main'
    m.rotation.set(0.4, 0.5, 0.3)
    g.add(m, edgeMesh(geo, color))
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), mat(color, { emissive: 0.45, metal: 0.6 }))
    spike.position.set(0.35, 0.55, 0.2)
    spike.rotation.z = -0.5
    g.add(spike)
    return g
  },
  // 定身骰：立方体被冰晶箍住
  freezeDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6)
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.15, metal: 0.3, flat: false }))
    m.name = 'main'
    g.add(m, edgeMesh(geo, color))
    const iceMat = mat(0xbfeaf5, { emissive: 0.4, rough: 0.05, flat: false })
    const band1 = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 6, 4), iceMat)
    band1.rotation.x = Math.PI / 2
    const band2 = band1.clone()
    band2.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), iceMat)
    crystal.position.set(0.55, 0.42, 0.3)
    g.add(band1, band2, crystal)
    return g
  },
  // 脆弱骰：带裂纹的压扁薄片
  frailDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.BoxGeometry(1.0, 0.14, 0.8)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.08, rough: 0.8 }))
    m.name = 'main'
    m.rotation.z = 0.15
    g.add(m, edgeMesh(geo, color))
    const crackMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
    const crack = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.4, 0.08, 0.2), new THREE.Vector3(-0.1, 0.08, -0.1),
      new THREE.Vector3(0.2, 0.08, 0.15), new THREE.Vector3(0.45, 0.08, -0.05)
    ]), crackMat)
    g.add(crack)
    return g
  },
  // 裂伤骰：分叉双钩刃
  vulnDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.2, 1.1, 4)
    const a = new THREE.Mesh(geo, mat(color, { emissive: 0.25, metal: 0.6 }))
    const b = a.clone()
    a.rotation.z = Math.PI / 3.5
    b.rotation.z = -Math.PI / 3.5
    a.position.x = -0.18
    b.position.x = 0.18
    a.name = 'main'
    g.add(a, b)
    return g
  },
  // 驱散骰：中空环+消散片
  dispelDie(color) {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 32), mat(color, { emissive: 0.25, flat: false }))
    ring.name = 'main'
    g.add(ring)
    const fragGeo = new THREE.TetrahedronGeometry(0.14)
    for (const p of [[0.72, 0.25, 0.1], [0.55, -0.5, 0.2], [-0.6, 0.4, -0.15]]) {
      const f = new THREE.Mesh(fragGeo, mat(color, { emissive: 0.15, rough: 0.6 }))
      f.position.set(...p)
      f.scale.setScalar(1 - Math.abs(p[0]) * 0.4)
      g.add(f)
    }
    return g
  },
  // 洪泛骰：主方块溢出两个小方块
  floodDie(color) {
    const g = new THREE.Group()
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(color, { rough: 0.35, metal: 0.4 }))
    main.name = 'main'
    main.position.y = -0.1
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat(color, { emissive: 0.25 }))
    s1.position.set(0.3, 0.5, 0.12)
    s1.rotation.y = 0.5
    const s2 = s1.clone()
    s2.position.set(-0.32, 0.58, -0.1)
    s2.rotation.y = -0.4
    s2.scale.setScalar(0.8)
    g.add(main, s1, s2)
    return g
  },
  // 心爆骰：球体炸开碎片群+核心
  mindBurstDie(color) {
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat(color, { emissive: 0.5, flat: false }))
    core.name = 'main'
    g.add(core)
    const fragGeo = new THREE.TetrahedronGeometry(0.2)
    const dirs = [[1, 0.2, 0], [-0.9, -0.3, 0.2], [0.2, 1, -0.2], [-0.1, -1, 0.1], [0.4, 0.3, 0.9], [-0.3, 0.5, -0.8]]
    for (const d of dirs) {
      const f = new THREE.Mesh(fragGeo, mat(color, { emissive: 0.3 }))
      const v = new THREE.Vector3(...d).normalize()
      f.position.copy(v.clone().multiplyScalar(0.72))
      f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)
      g.add(f)
    }
    return g
  },
  // 双相骰：两个交叠异色水滴
  twinMindDie(color) {
    const g = new THREE.Group()
    const drop = (c, x, rot) => {
      const grp = new THREE.Group()
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mat(c, { emissive: 0.2, flat: false }))
      ball.position.y = 0.14
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 12), mat(c, { emissive: 0.2, flat: false }))
      cone.rotation.x = Math.PI
      cone.position.y = -0.2
      grp.add(ball, cone)
      grp.position.x = x
      grp.rotation.z = rot
      return grp
    }
    const a = drop(color, -0.2, 0.5)
    const b = drop(new THREE.Color(color).offsetHSL(0.45, 0.1, -0.08).getHex(), 0.2, -0.5)
    a.children[0].name = 'main'
    g.add(a, b)
    return g
  },
  // 惊惧骰：倒立锥+内缩环
  dreadDie(color) {
    const g = new THREE.Group()
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 16), mat(color, { emissive: 0.18, flat: false }))
    cone.rotation.x = Math.PI
    cone.name = 'main'
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 20), mat(color, { emissive: 0.3 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.15
    g.add(cone, ring)
    return g
  },
  // 缓存骰：立方体带抽屉槽
  cacheDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), mat(color, { rough: 0.3, metal: 0.5 }))
    body.name = 'main'
    g.add(body, edgeMesh(body.geometry, color))
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), mat(color, { emissive: 0.3, metal: 0.55 }))
    drawer.position.set(0, -0.05, 0.42)
    g.add(drawer)
    return g
  },
  // 复刻骰：两个相同小八面体并排
  duplicateDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.42)
    const a = new THREE.Mesh(geo, mat(color, { emissive: 0.2, metal: 0.5 }))
    const b = a.clone()
    a.position.set(-0.32, 0, 0.1)
    b.position.set(0.32, 0, -0.05)
    b.rotation.y = 0.4
    a.name = 'main'
    g.add(a, b)
    return g
  },
  // 先导骰：大号四面体矛头向前
  vanguardDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.ConeGeometry(0.5, 1.5, 4)
    const m = new THREE.Mesh(geo, mat(color, { emissive: 0.3, metal: 0.6 }))
    m.name = 'main'
    m.rotation.x = Math.PI / 2
    m.rotation.z = 0
    g.add(m, edgeMesh(geo, color))
    return g
  },
  // 赏金骰：各面嵌圆形币纹
  bountyDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.68, 0.68), mat(color, { rough: 0.35, metal: 0.6 }))
    body.name = 'main'
    g.add(body)
    const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16)
    const coinMat = mat(0xf7d788, { emissive: 0.4, metal: 0.8, rough: 0.2 })
    for (const [pos, rot] of [
      [[0, 0, 0.37], [0, 0, 0]], [[0, 0, -0.37], [Math.PI, 0, 0]],
      [[0.37, 0, 0], [0, Math.PI / 2, 0]], [[-0.37, 0, 0], [0, -Math.PI / 2, 0]],
      [[0, 0.37, 0], [Math.PI / 2, 0, 0]], [[0, -0.37, 0], [-Math.PI / 2, 0, 0]]
    ]) {
      const c = new THREE.Mesh(coinGeo, coinMat)
      c.position.set(...pos)
      c.rotation.set(...rot)
      g.add(c)
    }
    return g
  },
  // 盾涌骰：圆环中央穿出一枚箭头
  shieldSurgeDie(color) {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 24), mat(color, { emissive: 0.2, metal: 0.5 }))
    ring.rotation.y = Math.PI / 2
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 4), mat(color, { emissive: 0.35, metal: 0.6 }))
    arrow.rotation.x = Math.PI / 2
    arrow.name = 'main'
    g.add(ring, arrow)
    return g
  },
  // 凝血盾骰：暗红六边板+滴落纹路
  hemoBarrierDie(color) {
    const g = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 6), mat(0xa8435c, { emissive: 0.18, rough: 0.4, metal: 0.4 }))
    plate.rotation.x = Math.PI / 2
    plate.name = 'main'
    g.add(plate, edgeMesh(plate.geometry, 0xd8708a, 0.08))
    const dropGeo = new THREE.SphereGeometry(0.08, 8, 6)
    const dropMat = mat(0xd8708a, { emissive: 0.4, flat: false })
    for (const p of [[0.2, -0.4, 0.15], [-0.25, -0.42, -0.1], [0.02, -0.5, 0.3]]) {
      const d = new THREE.Mesh(dropGeo, dropMat)
      d.position.set(...p)
      d.scale.y = 1.6
      g.add(d)
    }
    return g
  },
  // 格挡骰：两瓣对合的半圆盾
  parryDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 0.16, 16, 1, false, 0, Math.PI)
    const a = new THREE.Mesh(geo, mat(color, { rough: 0.2, metal: 0.55 }))
    const b = a.clone()
    a.rotation.x = Math.PI / 2
    b.rotation.set(Math.PI / 2, 0, Math.PI)
    a.position.z = 0.09
    b.position.z = -0.09
    a.name = 'main'
    g.add(a, b)
    return g
  },
  // 心蚀骰：紫黑环核+一面小盾片
  mindDrainDie(color) {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 10, 24), mat(color, { emissive: 0.22, flat: false }))
    ring.name = 'main'
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 6), mat(0x7fd8ff, { emissive: 0.3, metal: 0.5 }))
    shield.rotation.x = Math.PI / 2
    shield.position.set(0.5, 0.25, 0.2)
    g.add(ring, shield)
    return g
  },
  // 幻痛骰：扭曲的环结+裂片
  hallucinationDie(color) {
    const g = new THREE.Group()
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.36, 0.1, 48, 8), mat(color, { emissive: 0.25, flat: false }))
    knot.name = 'main'
    knot.rotation.z = 0.6
    g.add(knot)
    const fragGeo = new THREE.TetrahedronGeometry(0.16)
    for (const p of [[0.62, 0.3, 0], [-0.55, -0.35, 0.2]]) {
      const f = new THREE.Mesh(fragGeo, mat(color, { emissive: 0.15, rough: 0.6 }))
      f.position.set(...p)
      g.add(f)
    }
    return g
  },
  // 心幕骰：水滴与十字光交叠
  psycheVeilDie(color) {
    const g = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), mat(color, { emissive: 0.2, flat: false }))
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 12), mat(color, { emissive: 0.2, flat: false }))
    cone.rotation.x = Math.PI
    cone.position.y = -0.22
    ball.position.y = 0.16
    ball.name = 'main'
    const crossMat = mat(0xf0e6a8, { emissive: 0.5 })
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, 0.09), crossMat)
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), crossMat)
    c1.rotation.z = 0.5
    c2.rotation.z = 0.5
    g.add(ball, cone, c1, c2)
    return g
  },
  // 复仇骰：带锯齿裂痕的尖锐碎片
  vengeanceDie(color) {
    const g = new THREE.Group()
    const main = new THREE.Mesh(new THREE.TetrahedronGeometry(0.6), mat(color, { emissive: 0.3, metal: 0.55, rough: 0.5 }))
    main.rotation.set(0.2, 0.4, 0.5)
    main.name = 'main'
    g.add(main)
    const toothGeo = new THREE.TetrahedronGeometry(0.14)
    for (const p of [[0.5, 0.42, 0], [0.68, 0.18, 0.1], [0.42, 0.66, -0.1]]) {
      const t = new THREE.Mesh(toothGeo, mat(color, { emissive: 0.2 }))
      t.position.set(...p)
      g.add(t)
    }
    return g
  },
  // 亡命骰：半盾半刃的不对称八面体
  desperateDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat(color, { emissive: 0.18, metal: 0.5 }))
    body.name = 'main'
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9, 3), mat(color, { emissive: 0.4, metal: 0.65 }))
    blade.position.set(0.5, 0.1, 0)
    blade.rotation.z = -Math.PI / 2
    const halfRing = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 8, 12, Math.PI), mat(color, { emissive: 0.3, metal: 0.5 }))
    halfRing.position.set(-0.15, -0.3, 0)
    halfRing.rotation.z = Math.PI
    g.add(body, blade, halfRing)
    return g
  },
  // 废料骰：螺丝与小方块堆
  scrapDie(color) {
    const g = new THREE.Group()
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.8, 6), mat(color, { emissive: 0.15, metal: 0.7, rough: 0.3 }))
    screw.rotation.z = 0.9
    screw.position.set(-0.2, 0.1, 0)
    screw.name = 'main'
    const boxGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26)
    const b1 = new THREE.Mesh(boxGeo, mat(color, { emissive: 0.2, rough: 0.5 }))
    b1.position.set(0.32, 0.22, 0.1)
    b1.rotation.y = 0.6
    const b2 = new THREE.Mesh(boxGeo, mat(color, { emissive: 0.2, rough: 0.5 }))
    b2.position.set(0.25, -0.25, -0.12)
    b2.rotation.set(0.4, 0.2, 0.5)
    b2.scale.setScalar(0.7)
    g.add(screw, b1, b2)
    return g
  },
  // 转置骰：两个立方体以双箭头相连
  transposeDie(color) {
    const g = new THREE.Group()
    const boxGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42)
    const a = new THREE.Mesh(boxGeo, mat(color, { rough: 0.3, metal: 0.5 }))
    const b = a.clone()
    a.position.x = -0.45
    b.position.x = 0.45
    b.rotation.y = 0.5
    a.name = 'main'
    const arrowGeo = new THREE.ConeGeometry(0.1, 0.3, 4)
    const a1 = new THREE.Mesh(arrowGeo, mat(color, { emissive: 0.4 }))
    a1.rotation.z = -Math.PI / 2
    a1.position.set(0.1, 0.12, 0)
    const a2 = new THREE.Mesh(arrowGeo, mat(color, { emissive: 0.4 }))
    a2.rotation.z = Math.PI / 2
    a2.position.set(-0.1, -0.12, 0)
    g.add(a, b, a1, a2)
    return g
  },
  // 头奖骰：六面均为币纹的发光立方体
  jackpotDie(color) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.66, 0.66), mat(0xf7c873, { emissive: 0.3, metal: 0.7, rough: 0.25 }))
    body.name = 'main'
    g.add(body, edgeMesh(body.geometry, 0xffe9a8, 0.1))
    const coinGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 16)
    const coinMat = mat(0xffe9a8, { emissive: 0.55, metal: 0.85, rough: 0.15 })
    for (const [pos, rot] of [
      [[0, 0, 0.37], [0, 0, 0]], [[0, 0, -0.37], [Math.PI, 0, 0]],
      [[0.37, 0, 0], [0, Math.PI / 2, 0]], [[-0.37, 0, 0], [0, -Math.PI / 2, 0]],
      [[0, 0.37, 0], [Math.PI / 2, 0, 0]], [[0, -0.37, 0], [-Math.PI / 2, 0, 0]]
    ]) {
      const c = new THREE.Mesh(coinGeo, coinMat)
      c.position.set(...pos)
      c.rotation.set(...rot)
      g.add(c)
    }
    return g
  },
  // 彗星骰：带拖尾的拉长二十面体
  cometDie(color) {
    const g = new THREE.Group()
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(color, { emissive: 0.4, flat: false }))
    head.scale.set(1.6, 1, 1)
    head.rotation.z = -0.5
    head.name = 'main'
    g.add(head)
    const trailGeo = new THREE.ConeGeometry(0.16, 0.6, 6)
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(trailGeo, mat(color, { emissive: 0.3, flat: false, metal: 0.2 }))
      t.rotation.z = Math.PI / 2 + 0.15
      t.position.set(-0.75 - i * 0.3, 0.12 + i * 0.1, (i - 1) * 0.12)
      t.scale.setScalar(1 - i * 0.25)
      g.add(t)
    }
    return g
  },
  // 魔幕骰：晶板环绕一颗法球
  manaVeilDie(color) {
    const g = new THREE.Group()
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(color, { emissive: 0.45, flat: false }))
    orb.name = 'main'
    g.add(orb)
    const plateGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 6)
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(plateGeo, mat(color, { emissive: 0.25, metal: 0.5, rough: 0.2 }))
      const ang = (i / 4) * Math.PI * 2
      p.position.set(Math.cos(ang) * 0.62, Math.sin(ang) * 0.62, 0)
      p.rotation.z = ang
      g.add(p)
    }
    return g
  },
  // 弹幕骰：三枚细小四角星前后排列
  gatlingDie(color) {
    const g = new THREE.Group()
    const geo = new THREE.OctahedronGeometry(0.26)
    const stars = []
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo, mat(color, { emissive: 0.35, metal: 0.55 }))
      s.position.set(0, (i - 1) * 0.16, (i - 1) * 0.45)
      s.scale.set(0.6, 1.4, 0.6)
      s.rotation.y = i * 0.4
      stars.push(s)
    }
    stars[0].name = 'main'
    g.add(...stars)
    return g
  }
}

// ── 点数徽章：canvas 点阵 → 悬浮 sprite（始终面向相机） ──
function pipsBadge(pips, colorHex) {
  const size = 96
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  // 徽章底
  ctx.fillStyle = 'rgba(10,16,23,0.88)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0')
  ctx.lineWidth = 4
  ctx.stroke()
  // 点阵
  ctx.fillStyle = '#e8f2fa'
  const r = 8
  const pos = {
    1: [[48, 48]],
    2: [[30, 30], [66, 66]],
    3: [[30, 30], [48, 48], [66, 66]],
    4: [[30, 30], [66, 30], [30, 66], [66, 66]],
    5: [[30, 30], [66, 30], [48, 48], [30, 66], [66, 66]],
    6: [[30, 28], [66, 28], [30, 48], [66, 48], [30, 68], [66, 68]]
  }[Math.min(6, Math.max(1, pips))] || [[48, 48]]
  for (const [x, y] of pos) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  sp.scale.setScalar(0.55)
  sp.position.set(0, 0.95, 0)
  sp.renderOrder = 5
  return sp
}

// ── 对外接口：构建一颗骰子的完整模型 ──
// die: { defId, pips, kinds, uid? } → Group（含 main mesh / badge sprite）
export function buildDieModel(die) {
  const def = ALL_DICE[die.defId] || {}
  const builder = BUILDERS[die.defId] || BUILDERS.attack
  const color = dieColor(die)
  const g = builder(color)
  // 基础骰（attack/barrier/heal）按 defId 分型；attack4 走 attack
  g.userData.baseColor = new THREE.Color(color)
  // 点数徽章（基础骰随机点数；特殊骰固定点数）
  const pips = die.pips || def.pips || 1
  g.add(pipsBadge(pips, color))
  return g
}

// ── 图鉴快照：单颗骰子离屏渲染为 dataURL（串行复用同一 renderer） ──
let snapRenderer = null
export function renderDieSnapshot(die, size = 160) {
  if (!snapRenderer) {
    snapRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    snapRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  }
  const r = snapRenderer
  r.setSize(size, size, false)
  const scene = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  cam.position.set(0.9, 1.1, 3.2)
  cam.lookAt(0, 0, 0)
  scene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const dir = new THREE.DirectionalLight(0xffffff, 1.5)
  dir.position.set(3, 5, 4)
  scene.add(dir)
  const model = buildDieModel(die)
  model.rotation.set(0.35, 0.7, 0.05)
  scene.add(model)
  r.render(scene, cam)
  const url = r.domElement.toDataURL('image/png')
  scene.remove(model)
  // 释放该模型的几何与材质
  model.traverse((o) => {
    o.geometry?.dispose?.()
    if (o.material) {
      o.material.map?.dispose?.()
      o.material.dispose()
    }
  })
  return url
}
