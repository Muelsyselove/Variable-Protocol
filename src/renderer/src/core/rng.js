// 可复现随机数（mulberry32）：状态可序列化，随局内存档持久化
let state = 123456789

export function seedRNG(seed) {
  state = (seed >>> 0) || 123456789
}

export function rng() {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function rngInt(n) {
  return Math.floor(rng() * n)
}

export function rngPick(arr) {
  return arr[rngInt(arr.length)]
}

export function rngChance(p) {
  return rng() < p
}

export function rngState() {
  return state
}

export function setRngState(s) {
  state = s >>> 0
}

// 抽取骰子：从池中按等概率随机挑选（不取出）
export function rngDraw(pool) {
  return pool[rngInt(pool.length)]
}
