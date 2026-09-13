// 色度键控抠图：品红背景 → 透明（含边缘去污染，无需缩放）
// 用法：node scripts/chroma-matte.mjs <输入.png> <输出.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const [input, output] = process.argv.slice(2)

// ── PNG 解码/编码（复用既有实现） ──
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
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ])
}

// ══════════ 主流程 ══════════
const { width: W, height: H, ch, px } = decodePng(readFileSync(input))
console.log(`输入: ${W}x${H} · 通道${ch}`)
const N = W * H
const rgba = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  rgba[i * 4] = px[i * ch]
  rgba[i * 4 + 1] = px[i * ch + 1]
  rgba[i * 4 + 2] = px[i * ch + 2]
  rgba[i * 4 + 3] = 255
}

// ── 1. 估计键色（四角均值） ──
const corners = [[3, 3], [W - 4, 3], [3, H - 4], [W - 4, H - 4]]
let KR = 0, KG = 0, KB = 0
for (const [cx, cy] of corners) {
  const i = (cy * W + cx) * 4
  KR += rgba[i] / 4; KG += rgba[i + 1] / 4; KB += rgba[i + 2] / 4
}
console.log(`键色: rgb(${KR.toFixed(0)},${KG.toFixed(0)},${KB.toFixed(0)})`)

// ── 2. 品红度映射：mag = min(R,B) - G（高=品红；低=前景） ──
// 键色的品红度参考值
const keyMag = Math.min(KR, KB) - KG
const magOf = (i) => Math.min(rgba[i], rgba[i + 2]) - rgba[i + 1]
// 前景色距：与键色的夹角距离（排除亮度差异）
const dist2key = (i) => Math.abs(rgba[i] - KR) + Math.abs(rgba[i + 1] - KG) + Math.abs(rgba[i + 2] - KB)

// 判定阈值：品红度 > 全键品红度的45% 且色距小 → 背景
const MAG_T = keyMag * 0.45
const DIST_T = 160

// ── 3. 洪泛：从四边入队（连通的品红区域判为背景） ──
const removed = new Uint8Array(N)
const queue = new Int32Array(N)
let qh = 0, qt = 0
const isBg = (idx) => {
  const i = idx * 4
  return magOf(i) > MAG_T && dist2key(i) < DIST_T
}
const push = (idx) => {
  if (removed[idx] || !isBg(idx)) return
  removed[idx] = 1
  queue[qt++] = idx
}
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
while (qh < qt) {
  const idx = queue[qh++]
  const x = idx % W
  if (x > 0) push(idx - 1)
  if (x < W - 1) push(idx + 1)
  if (idx >= W) push(idx - W)
  if (idx < N - W) push(idx + W)
}
let removedCount = 0
for (let i = 0; i < N; i++) if (removed[i]) removedCount++
console.log(`洪泛抠图: 移除 ${(removedCount / N * 100).toFixed(1)}%`)

// ── 4. 边缘处理：品红污染去除 + alpha羽化 ──
// 对与背景接壤的前景像素：按品红度解alpha，并反解前景色 C = (P - (1-α)K)/α
let feathered = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x
    if (removed[idx]) { rgba[idx * 4 + 3] = 0; continue }
    const near = (x > 0 && removed[idx - 1]) || (x < W - 1 && removed[idx + 1]) ||
      (y > 0 && removed[idx - W]) || (y < H - 1 && removed[idx + W])
    if (!near) continue
    const i = idx * 4
    const mag = magOf(i)
    if (mag < 8) continue // 无污染
    // alpha：品红度接近键色→透明；接近0→不透明
    const a = Math.max(0, Math.min(1, 1 - mag / keyMag))
    if (a <= 0.02) { rgba[idx * 4 + 3] = 0; feathered++; continue }
    if (a >= 0.98) continue
    // 反解前景色（剔除品红分量）
    for (let c = 0; c < 3; c++) {
      const k = c === 0 ? KR : c === 1 ? KG : KB
      let v = (rgba[i + c] - (1 - a) * k) / a
      rgba[i + c] = Math.max(0, Math.min(255, Math.round(v)))
    }
    rgba[i + 4 - 1] = Math.round(a * 255)
    feathered++
  }
}
console.log(`边缘去污染+羽化: ${feathered} 像素`)

// ── 5. 二次清理：主体内部的孤立品红残留（洪泛未达且被前景包裹） ──
// 按非连通品红强度清理：品红度 > 70%键色 的非边缘像素也判为残留（角色配色不含品红，安全）
let cleaned = 0
for (let i = 0; i < N; i++) {
  if (removed[i]) continue
  const idx = i * 4
  if (magOf(idx) > keyMag * 0.7 && dist2key(idx) < DIST_T * 0.6) {
    rgba[idx + 3] = 0
    cleaned++
  }
}
if (cleaned > 0) console.log(`内部残留清理: ${cleaned} 像素`)

writeFileSync(output, encodePng(rgba, W, H))
console.log(`已输出: ${output}（${W}x${H} RGBA）`)
