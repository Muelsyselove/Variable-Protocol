// 分析立绘背景结构：边缘采样 + 颜色聚类，判断背景可抠性
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)

// ── PNG 解码（仅支持8位RGBA非隔行） ──
let pos = 8
let width = 0, height = 0, bitDepth, colorType
const idatChunks = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
  } else if (type === 'IDAT') {
    idatChunks.push(data)
  } else if (type === 'IEND') break
  pos += 12 + len
}
console.log(`尺寸: ${width}x${height} · bitDepth=${bitDepth} colorType=${colorType}`)
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  console.log('非8位RGBA/RGB，需其他处理')
  process.exit(0)
}
const hasAlpha = colorType === 6
const ch = hasAlpha ? 4 : 3
const raw = inflateSync(Buffer.concat(idatChunks))

// 反滤波
const stride = width * ch
const pixels = Buffer.alloc(height * stride)
let rp = 0
for (let y = 0; y < height; y++) {
  const filter = raw[rp++]
  const rowStart = y * stride
  for (let x = 0; x < stride; x++) {
    const cur = raw[rp++]
    const left = x >= ch ? pixels[rowStart + x - ch] : 0
    const up = y > 0 ? pixels[rowStart - stride + x] : 0
    const ul = (y > 0 && x >= ch) ? pixels[rowStart - stride + x - ch] : 0
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
    pixels[rowStart + x] = val & 0xff
  }
}

// ── 边缘采样：四边各采一行/列 ──
const samples = []
const px = (x, y) => {
  const i = (y * width + x) * ch
  return [pixels[i], pixels[i + 1], pixels[i + 2], hasAlpha ? pixels[i + 3] : 255]
}
for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 50))) {
  samples.push(px(x, 0)); samples.push(px(x, height - 1))
}
for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 50))) {
  samples.push(px(0, y)); samples.push(px(width - 1, y))
}

// 颜色统计
let minR = 999, maxR = -1, minG = 999, maxG = -1, minB = 999, maxB = -1
let alphaZero = 0
for (const [r, g, b, a] of samples) {
  if (a < 10) { alphaZero++; continue }
  minR = Math.min(minR, r); maxR = Math.max(maxR, r)
  minG = Math.min(minG, g); maxG = Math.max(maxG, g)
  minB = Math.min(minB, b); maxB = Math.max(maxB, b)
}
console.log(`边缘采样 ${samples.length} 点 · 透明点 ${alphaZero}`)
if (samples.length - alphaZero > 0) {
  console.log(`背景色范围 R[${minR},${maxR}] G[${minG},${maxG}] B[${minB},${maxB}]`)
  const range = Math.max(maxR - minR, maxG - minG, maxB - minB)
  console.log(`色彩跨度: ${range}（<40 近纯色可 flood-fill；40~100 渐变需容差flood-fill；>100 复杂背景）`)
}
// 检查是否本来就是透明背景
if (hasAlpha) {
  let transparentCount = 0
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 10) transparentCount++
  const pct = (transparentCount / (width * height) * 100).toFixed(1)
  console.log(`已有透明像素占比: ${pct}%`)
}
