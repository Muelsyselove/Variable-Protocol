// 黑键抠图：纯黑背景（服务商对"透明"的渲染）→ 真透明
// 用法：node scripts/black-matte.mjs <输入.png> <输出.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const [input, output] = process.argv.slice(2)

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

const { width: W, height: H, ch, px } = decodePng(readFileSync(input))
const N = W * H
const rgba = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  rgba[i * 4] = px[i * ch]
  rgba[i * 4 + 1] = px[i * ch + 1]
  rgba[i * 4 + 2] = px[i * ch + 2]
  rgba[i * 4 + 3] = 255
}

// ── 黑判定：亮度低于阈值视为黑（含少量压缩噪声） ──
const DARK = 26
const lum = (i) => (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000
const isBg = (i) => lum(i) < DARK

// ── 洪泛：边缘连通的黑区域 ──
const removed = new Uint8Array(N)
const queue = new Int32Array(N)
let qh = 0, qt = 0
const push = (idx) => {
  if (removed[idx] || !isBg(idx * 4)) return
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
let rc = 0
for (let i = 0; i < N; i++) if (removed[i]) rc++
console.log(`${W}x${H} · 洪泛移除 ${(rc / N * 100).toFixed(1)}%`)

// ── 边缘羽化：与背景接壤的暗像素按亮度梯度给alpha ──
let feathered = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x
    if (removed[idx]) { rgba[idx * 4 + 3] = 0; continue }
    const near = (x > 0 && removed[idx - 1]) || (x < W - 1 && removed[idx + 1]) ||
      (y > 0 && removed[idx - W]) || (y < H - 1 && removed[idx + W])
    if (!near) continue
    const L = lum(idx * 4)
    if (L < DARK * 4) {
      // 暗边（描边/阴影）：亮度归一为alpha，保留但不完全透明
      const a = Math.max(0.25, L / (DARK * 4))
      rgba[idx * 4 + 3] = Math.round(a * 255)
      feathered++
    }
  }
}
console.log(`羽化 ${feathered} 像素`)

writeFileSync(output, encodePng(rgba, W, H))
console.log(`输出: ${output}`)
