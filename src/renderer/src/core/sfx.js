// 音效引擎：Web Audio 实时合成（零素材依赖）
// 所有音效均为程序化生成的原创电子音，经主增益节点输出
// API：sfx.play(name) / sfx.setEnabled(bool) / sfx.setVolume(0..1) / sfx.resume()

let ctx = null
let master = null
let noiseBuf = null
let enabled = true
let volume = 0.8

// 初始化（首次用户手势时调用，规避自动播放限制）
export function initSfx() {
  if (ctx) return
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = enabled ? volume : 0
  master.connect(ctx.destination)
  // 白噪声缓冲（1秒）
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
}

// 页面首次手势后恢复上下文（主入口挂接）
export function resumeSfx() {
  if (!ctx) initSfx()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

export function setSfxEnabled(v) {
  enabled = !!v
  if (master) master.gain.value = enabled ? volume : 0
}

export function setSfxVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0))
  if (master && enabled) master.gain.value = volume
}

// ── 基础合成原语 ──
function tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.15, vol = 0.5, delay = 0, attack = 0.004, curve = 'exp' }) {
  if (!ctx || !enabled) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(Math.max(20, f0), t0)
  if (f1 != null) {
    if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    else osc.frequency.linearRampToValueAtTime(Math.max(20, f1), t0 + dur)
  }
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.connect(g).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise({ dur = 0.12, vol = 0.3, delay = 0, f0 = 2400, f1 = 400, q = 1 }) {
  if (!ctx || !enabled) return
  const t0 = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(f0, t0)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur)
  filter.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  src.connect(filter).connect(g).connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

// ── 音效表（全部原创合成音） ──
const SOUNDS = {
  // UI
  click: () => tone({ type: 'square', f0: 820, f1: 520, dur: 0.05, vol: 0.14 }),
  open: () => { tone({ type: 'sine', f0: 320, f1: 640, dur: 0.09, vol: 0.12 }); noise({ dur: 0.08, vol: 0.04, f0: 1200, f1: 3200 }) },
  back: () => tone({ type: 'sine', f0: 520, f1: 300, dur: 0.09, vol: 0.12 }),
  toggle: () => tone({ type: 'square', f0: 640, f1: 900, dur: 0.05, vol: 0.12 }),

  // 战斗
  dice: () => { noise({ dur: 0.05, vol: 0.16, f0: 2600, f1: 1400 }); noise({ dur: 0.05, vol: 0.12, f0: 2000, f1: 1000, delay: 0.06 }) },
  hit: () => { noise({ dur: 0.14, vol: 0.32, f0: 900, f1: 180 }); tone({ type: 'sine', f0: 190, f1: 70, dur: 0.16, vol: 0.4 }) },
  hitEnemy: () => { noise({ dur: 0.12, vol: 0.26, f0: 1400, f1: 300 }); tone({ type: 'sine', f0: 260, f1: 100, dur: 0.14, vol: 0.32 }) },
  block: () => { tone({ type: 'triangle', f0: 980, f1: 720, dur: 0.08, vol: 0.2 }); noise({ dur: 0.06, vol: 0.1, f0: 3000, f1: 1800 }) },
  heal: () => { tone({ type: 'sine', f0: 520, f1: 780, dur: 0.16, vol: 0.2 }); tone({ type: 'sine', f0: 780, f1: 1040, dur: 0.18, vol: 0.14, delay: 0.1 }) },
  psychic: () => { tone({ type: 'triangle', f0: 460, f1: 300, dur: 0.22, vol: 0.2 }); tone({ type: 'triangle', f0: 466, f1: 310, dur: 0.22, vol: 0.14 }) },
  crash: () => { tone({ type: 'sawtooth', f0: 320, f1: 60, dur: 0.5, vol: 0.3 }); noise({ dur: 0.4, vol: 0.2, f0: 1600, f1: 200 }) },
  para: () => tone({ type: 'square', f0: 300, f1: 120, dur: 0.2, vol: 0.18 }),
  buff: () => tone({ type: 'sine', f0: 600, f1: 880, dur: 0.12, vol: 0.14 }),
  debuff: () => tone({ type: 'sine', f0: 440, f1: 260, dur: 0.14, vol: 0.14 }),

  // 结算
  victory: () => {
    ;[[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([f, d]) => tone({ type: 'triangle', f0: f, dur: 0.22, vol: 0.22, delay: d }))
    tone({ type: 'sine', f0: 1568, dur: 0.4, vol: 0.1, delay: 0.48 })
  },
  defeat: () => {
    ;[[440, 0], [349, 0.16], [294, 0.32]].forEach(([f, d]) => tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.2, delay: d }))
    tone({ type: 'sine', f0: 220, f1: 110, dur: 0.6, vol: 0.16, delay: 0.44 })
  },
  coin: () => { tone({ type: 'sine', f0: 1319, dur: 0.09, vol: 0.2 }); tone({ type: 'sine', f0: 1976, dur: 0.24, vol: 0.18, delay: 0.07 }) },

  // 桌宠
  pet: () => { tone({ type: 'sine', f0: 880, f1: 1175, dur: 0.09, vol: 0.18 }); tone({ type: 'sine', f0: 1175, f1: 988, dur: 0.12, vol: 0.14, delay: 0.09 }) },
  eat: () => { noise({ dur: 0.07, vol: 0.12, f0: 900, f1: 500 }); noise({ dur: 0.07, vol: 0.1, f0: 800, f1: 400, delay: 0.12 }); tone({ type: 'sine', f0: 988, f1: 1319, dur: 0.12, vol: 0.12, delay: 0.22 }) },
  buy: () => { tone({ type: 'sine', f0: 1319, dur: 0.08, vol: 0.18 }); tone({ type: 'sine', f0: 1760, dur: 0.1, vol: 0.18, delay: 0.07 }); tone({ type: 'square', f0: 520, f1: 640, dur: 0.05, vol: 0.08, delay: 0.02 }) },
  error: () => tone({ type: 'square', f0: 220, f1: 180, dur: 0.16, vol: 0.16 })
}

// 播放（未知名称忽略；禁用或未初始化时静默）
export function playSfx(name) {
  if (!ctx || !enabled) return
  try {
    SOUNDS[name]?.()
  } catch {
    /* 音频失败不影响游戏 */
  }
}
