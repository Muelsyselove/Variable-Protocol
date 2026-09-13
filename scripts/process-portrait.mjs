// 立绘处理：透明背景抠图（逐行背景建模+洪泛）→ 边缘羽化 → Lanczos-3 2K放大
// 用法：node scripts/process-portrait.mjs <输入.png> <输出.png> [放大倍数=2]
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const [input, output, scaleArg] = process.argv.slice(2)
const SCALE = Number(scaleArg) || 2

// ══════════ PNG 解码（8位RGB/RGBA） ══════════
function decodePng(buf) {
  let pos = 8
  let width = 0, height = 0, colorType
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]
      if (data[8] !== 8) throw new Error('仅支持8位PNG')
      if (data[12] !== 0) throw new Error('不支持隔行PNG')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const ch = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const px = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const rs = y * stride
    for (let x = 0; x < stride; x++) {
      const cur = raw[rp++]
      const left = x >= ch ? px[rs + x - ch] : 0
      const up = y > 0 ? px[rs - stride + x] : 0
      const ul = (y > 0 && x >= ch) ? px[rs - stride + x - ch] : 0
      let val
      switch (filter) {
        case 0: val = cur; break
        case 1: val = cur + left; break
        case 2: val = cur + up; break
        case 3: val = cur + ((left + up) >> 1); break
        case 4: {
          const p = left + up - ul
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul)
          val = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
          break
        }
        default: val = cur
      }
      px[rs + x] = val & 0xff
    }
  }
  return { width, height, ch, px }
}

// ══════════ PNG 编码（8位RGBA） ══════════
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ══════════ 主流程 ══════════
const { width: W, height: H, ch, px } = decodePng(readFileSync(input))
console.log(`输入: ${W}x${H} · 通道${ch}`)

// ── 1. 归一化为 RGBA ──
const rgba = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) {
  rgba[i * 4] = px[i * ch]
  rgba[i * 4 + 1] = px[i * ch + 1]
  rgba[i * 4 + 2] = px[i * ch + 2]
  rgba[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255
}

// ── 2. 逐行背景建模：每行取左右两侧边缘条带均值，横向线性插值 ──
const bgL = new Array(H), bgR = new Array(H)
const EDGE = 8
for (let y = 0; y < H; y++) {
  let r1 = 0, g1 = 0, b1 = 0, r2 = 0, g2 = 0, b2 = 0
  for (let k = 0; k < EDGE; k++) {
    const iL = (y * W + k) * 4
    r1 += rgba[iL]; g1 += rgba[iL + 1]; b1 += rgba[iL + 2]
    const iR = (y * W + (W - 1 - k)) * 4
    r2 += rgba[iR]; g2 += rgba[iR + 1]; b2 += rgba[iR + 2]
  }
  bgL[y] = [r1 / EDGE, g1 / EDGE, b1 / EDGE]
  bgR[y] = [r2 / EDGE, g2 / EDGE, b2 / EDGE]
}
// bg(x,y) = 左右插值
const bgAt = (x, y) => {
  const t = x / (W - 1)
  return [
    bgL[y][0] + (bgR[y][0] - bgL[y][0]) * t,
    bgL[y][1] + (bgR[y][1] - bgL[y][1]) * t,
    bgL[y][2] + (bgR[y][2] - bgL[y][2]) * t
  ]
}
const dist2bg = (x, y) => {
  const i = (y * W + x) * 4
  const b = bgAt(x, y)
  return Math.abs(rgba[i] - b[0]) + Math.abs(rgba[i + 1] - b[1]) + Math.abs(rgba[i + 2] - b[2])
}

// ── 3. 洪泛抠图：从四边入队，容差内且连通的像素判为背景 ──
const TOL = 72
const removed = new Uint8Array(W * H)
const queue = new Int32Array(W * H)
let qh = 0, qt = 0
const push = (x, y) => {
  const idx = y * W + x
  if (removed[idx]) return
  if (dist2bg(x, y) >= TOL) return
  removed[idx] = 1
  queue[qt++] = idx
}
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
while (qh < qt) {
  const idx = queue[qh++]
  const x = idx % W, y = (idx / W) | 0
  if (x > 0) push(x - 1, y)
  if (x < W - 1) push(x + 1, y)
  if (y > 0) push(x, y - 1)
  if (y < H - 1) push(x, y + 1)
}
let removedCount = 0
for (let i = 0; i < removed.length; i++) if (removed[i]) removedCount++
console.log(`洪泛抠图: 移除 ${(removedCount / (W * H) * 100).toFixed(1)}% 像素（容差${TOL}）`)

// ── 4. 边缘羽化：保留像素中与背景接壤的，按色距给半透明 ──
// 先统计"接壤"标记（4邻域有背景的保留像素）
const edgePixels = []
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x
    if (removed[idx]) continue
    const near = (x > 0 && removed[idx - 1]) || (x < W - 1 && removed[idx + 1]) ||
      (y > 0 && removed[idx - W]) || (y < H - 1 && removed[idx + W])
    if (near) edgePixels.push(idx)
  }
}
for (const idx of edgePixels) {
  const x = idx % W, y = (idx / W) | 0
  const d = dist2bg(x, y)
  // 色距略高于容差的抗锯齿边：部分透明；远离容差则不透明
  const a = Math.max(0.15, Math.min(1, (d - TOL * 0.45) / (TOL * 0.55)))
  rgba[idx * 4 + 3] = Math.round(a * 255)
}
console.log(`边缘羽化: ${edgePixels.length} 像素`)

// 应用移除
for (let i = 0; i < W * H; i++) if (removed[i]) rgba[i * 4 + 3] = 0

// ── 5. Lanczos-3 放大（可分离：横向→纵向） ──
function lanczos3(x) {
  if (x === 0) return 1
  const ax = Math.abs(x)
  if (ax >= 3) return 0
  const px2 = Math.PI * x
  return (Math.sin(px2) / px2) * (Math.sin(px2 / 3) / (px2 / 3))
}
function buildWeights(srcLen, dstLen) {
  // 每个输出像素的源采样点与权重
  const list = []
  for (let o = 0; o < dstLen; o++) {
    const center = (o + 0.5) * srcLen / dstLen - 0.5
    const taps = []
    const lo = Math.floor(center) - 2, hi = Math.floor(center) + 3
    let sum = 0
    for (let s = lo; s <= hi; s++) {
      const w = lanczos3(center - s)
      if (w !== 0) { taps.push([Math.max(0, Math.min(srcLen - 1, s)), w]); sum += w }
    }
    for (const t of taps) t[1] /= sum
    list.push(taps)
  }
  return list
}
function resample(src, sw, sh, dw, dh) {
  // 横向
  const wx = buildWeights(sw, dw)
  const mid = Buffer.alloc(dw * sh * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (const [sx, w] of wx[x]) {
        const i = (y * sw + sx) * 4
        const wa = w * (src[i + 3] / 255)
        r += src[i] * wa; g += src[i + 1] * wa; b += src[i + 2] * wa; a += wa
      }
      const o = (y * dw + x) * 4
      if (a > 0) {
        mid[o] = Math.min(255, r / a); mid[o + 1] = Math.min(255, g / a); mid[o + 2] = Math.min(255, b / a)
        mid[o + 3] = Math.min(255, a / 1 * 255 / 1) // 权重已归一，a即alpha加权和
      }
      // a为0时保持0（透明黑）
    }
  }
  // 纵向
  const wy = buildWeights(sh, dh)
  const dst = Buffer.alloc(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (const [sy, w] of wy[y]) {
        const i = (sy * dw + x) * 4
        const wa = w * (mid[i + 3] / 255)
        r += mid[i] * wa; g += mid[i + 1] * wa; b += mid[i + 2] * wa; a += wa
      }
      const o = (y * dw + x) * 4
      if (a > 0) {
        dst[o] = Math.min(255, r / a); dst[o + 1] = Math.min(255, g / a); dst[o + 2] = Math.min(255, b / a)
        dst[o + 3] = Math.round(Math.min(1, a) * 255)
      }
    }
  }
  return dst
}

const NW = Math.round(W * SCALE), NH = Math.round(H * SCALE)
console.log(`Lanczos-3 放大: ${W}x${H} → ${NW}x${NH} …`)
const out = resample(rgba, W, H, NW, NH)

// ── 6. 输出 ──
writeFileSync(output, encodePng(out, NW, NH))
console.log(`已输出: ${output}（${NW}x${NH} · ${(out.length / 1024 / 1024).toFixed(1)}MB原始）`)
