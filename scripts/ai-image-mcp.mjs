#!/usr/bin/env node
/**
 * AI 生图 MCP 服务器（零依赖，stdio 传输，JSON-RPC 2.0 按行分帧）
 *
 * 配置（环境变量，在 MCP 注册处填写）：
 *   AI_IMAGE_BASE_URL  服务商 API 基础地址（OpenAI 兼容，如 https://api.example.com/v1）
 *   AI_IMAGE_API_KEY   API 密钥
 *   AI_IMAGE_MODEL     模型名称（如 dall-e-3、gpt-image-1、gpt-image-2.5 等）
 *
 * 工具：generate_image(prompt, destination, reference_images?)
 *   - 纯文生图：调用 {BASE_URL}/images/generations
 *   - 提供参考图：调用 {BASE_URL}/images/edits（multipart），用于微调或同一角色/主体的不同表现
 *   - 结果直接写入 destination 指定位置（目录则自动按时间戳命名）
 *   - 所有生成要求（尺寸、透明背景、风格等）直接写在提示词中，无需填写其他指令参数
 *   - 同一时间仅允许 1 个生成任务，生成中再次调用会被拒绝
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import readline from 'node:readline';

const SERVER_NAME = 'ai-image-mcp';
const SERVER_VERSION = '1.4.0';
const REQUEST_TIMEOUT_MS = 300_000; // 5 分钟
const MIN_GENERATE_INTERVAL_MS = 10_000; // 两次生图请求的最小间隔（防上游限流），从请求发起时计时

const BASE_URL = (process.env.AI_IMAGE_BASE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = (process.env.AI_IMAGE_API_KEY || '').trim();
const MODEL = (process.env.AI_IMAGE_MODEL || '').trim();

let generating = false; // 互斥：同时只允许生成 1 张
let lastGenerateStartAt = 0; // 上次生图请求发起时间（无论成败均计入间隔）

function log(msg) {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolText(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

const TOOLS = [
  {
    name: 'generate_image',
    description:
      '调用 AI 生图接口生成 1 张图片，并直接保存到指定位置。同一时间仅允许生成 1 张；两次生图请求间隔不得少于 10 秒（防上游限流）；' +
      '目标目录不存在时会自动创建。' +
      '所有生成要求（尺寸、透明背景、风格、质量等）直接写在提示词中即可，不需要填写任何其他指令参数：' +
      '例如在提示词中写"透明背景"将自动输出带透明通道的 PNG（生成后自动校验透明是否生效），' +
      '尺寸要求（如"1024x1024"）也直接写入提示词。' +
      '提示词中出现 2048 及以上像素尺寸时会向上游透传 size 参数争取原生高分辨率；' +
      '若此时同时要求透明背景，上游无法直接输出透明底，将自动改用纯品红色背景生成并在本地色键抠图，最终仍输出带透明通道的 PNG。' +
      '需要同一角色/主体的不同表现（换姿势、换表情、换配色、微调细节）时，应先向用户索取该角色已有的图片路径，' +
      '并通过 reference_images 提交以保持形象一致；纯文生图时无需提供参考图。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            '图片描述（提示词）。所有生成要求都写在这里：尺寸（如 1024x1024）、透明背景、风格、质量等。' +
            '提供参考图时描述要做的修改或想要的表现变化'
        },
        destination: {
          type: 'string',
          description:
            '目标保存位置（绝对路径）。可以是完整文件路径（建议 .png/.jpg/.jpeg/.webp），' +
            '也可以是目录（自动以时间戳命名保存为 PNG）'
        },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
          description:
            '可选。参考图的本地绝对路径（1~4 张，须为已存在的图片文件）。提供后走图像编辑接口：' +
            '以参考图为基准微调细节，或生成同一角色/主体的不同表现（换姿势、表情、配色、场景等）'
        }
      },
      required: ['prompt', 'destination']
    }
  }
];

function missingConfig() {
  const miss = [];
  if (!BASE_URL) miss.push('AI_IMAGE_BASE_URL');
  if (!API_KEY) miss.push('AI_IMAGE_API_KEY');
  if (!MODEL) miss.push('AI_IMAGE_MODEL');
  return miss;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 响应可能不是 JSON */
    }
    return { res, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function resolveDestination(input) {
  let p = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!p) throw new Error('目标位置为空');
  const abs = isAbsolute(p) ? p : resolve(p);
  let asDir = /[\\/]$/.test(p);
  if (!asDir && !extname(abs)) asDir = true;
  if (!asDir && existsSync(abs) && statSync(abs).isDirectory()) asDir = true;
  if (asDir) {
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}` +
      `_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
    return join(abs, `AI_${stamp}.png`);
  }
  return abs;
}

// 解析生图/编辑接口的响应，提取图片二进制
async function parseImageResponse(r) {
  const item = r.json?.data?.[0];
  if (!item) {
    throw new Error(`生图接口响应中没有 data[0]：${(r.text || '').slice(0, 300)}`);
  }
  let buffer;
  if (typeof item.b64_json === 'string' && item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (typeof item.url === 'string' && item.url) {
    buffer = await downloadImage(item.url);
  } else {
    throw new Error('生图接口响应中既没有 b64_json 也没有 url');
  }
  if (!buffer || buffer.length === 0) throw new Error('获取到的图片数据为空');
  return { buffer, item };
}

// 透明模式判定：提示词包含“透明背景”/“transparent background”即视为透明输出需求。
// 该服务的透明靠提示词实现，且请求带 size 参数会触发转码丢失 alpha 通道，
// 因此常规情况不传 size——尺寸等要求一律写在提示词中由模型理解。
// 例外：提示词出现显式像素尺寸且长边 ≥ 2048（2K及以上）时向上游透传 size 争取高分辨率；
// 此时上游无法输出透明底，若同时要求透明，则自动改写为纯品红色背景生成，
// 完成后在本服务内做色键抠图（品红 → alpha），最终仍输出带透明通道的 PNG。
const TRANSPARENT_RE = /透明背景|transparent\s*background/i;
const SIZE_RE = /(\d{3,5})\s*[x×]\s*(\d{3,5})/;

// 从提示词解析显式像素尺寸；长边 ≥ 2048 时返回 "宽x高"，否则返回 null
function parseOversize(prompt) {
  const m = SIZE_RE.exec(prompt);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h || Math.max(w, h) < 2048) return null;
  return `${w}x${h}`;
}

// 大尺寸+透明需求时改写提示词：透明要求换成纯品红背景（供色键抠图）
function rewritePromptForChroma(prompt) {
  let p = prompt
    .replace(/纯透明背景|透明背景|transparent\s*background/gi, '纯品红色背景（#FF00FF 纯色填充）')
    .replace(/纯色背景PNG/g, 'PNG');
  p += '。背景必须是完全纯净的品红色（#FF00FF），均匀填充，无渐变、无阴影、无光晕、无杂色，主体边缘清晰不与背景混色';
  return p;
}

// ── PNG 色键抠图（零依赖：仅支持 8-bit、colorType 2/6）──

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// 解码 PNG：返回 { width, height, channels(3|4), pixels }
function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('输出不是有效 PNG 文件');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`抠图不支持的 PNG 格式（bitDepth=${bitDepth}, colorType=${colorType}），仅支持 8-bit RGB/RGBA`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let val = row[x];
      if (filter === 1) val += a;
      else if (filter === 2) val += b;
      else if (filter === 3) val += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = val & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

// 编码 PNG（8-bit RGBA，filter 0）
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// 品红色键抠图：接近品红的像素 → 透明，过渡带渐变 alpha，并去除边缘品红溢色
function chromaKeyMagenta(width, height, channels, pixels) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * channels];
    const g = pixels[i * channels + 1];
    const b = pixels[i * channels + 2];
    // 与品红(255,0,255)的切比雪夫距离：品红处为0，白/青绿等高
    const d = Math.max(255 - r, g, 255 - b);
    let alpha;
    if (d <= 60) alpha = 0;
    else if (d >= 140) alpha = 255;
    else alpha = Math.round(((d - 60) / 80) * 255);
    let nr = r, ng = g, nb = b;
    if (alpha > 0) {
      // 去溢色：品红特征（r、b 同时显著高于 g）压向 g
      const m = Math.min(r, b) - g;
      if (m > 0) { nr = r - m; nb = b - m; }
    }
    out[i * 4] = nr;
    out[i * 4 + 1] = ng;
    out[i * 4 + 2] = nb;
    out[i * 4 + 3] = alpha;
  }
  return out;
}

// 纯文生图：/images/generations（JSON）
async function callGenerations(prompt, size) {
  const endpoint = `${BASE_URL}/images/generations`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`
  };
  const baseBody = { model: MODEL, prompt, n: 1 };
  if (size) baseBody.size = size;

  // 先请求 b64_json；若服务不支持 response_format 参数（4xx），降级为默认格式重试
  let r = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...baseBody, response_format: 'b64_json' })
  });
  if (!r.res.ok && r.res.status >= 400 && r.res.status < 500 && r.res.status !== 401 && r.res.status !== 403) {
    r = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...baseBody })
    });
  }
  if (!r.res.ok) {
    throw new Error(`生图接口返回 HTTP ${r.res.status}：${(r.text || '').slice(0, 500)}`);
  }
  return parseImageResponse(r);
}

// 参考图编辑：/images/edits（multipart），用于微调或同一角色/主体的不同表现
async function callEdits(prompt, referenceImages, size) {
  const endpoint = `${BASE_URL}/images/edits`;
  const fd = new FormData();
  fd.append('model', MODEL);
  fd.append('prompt', prompt);
  fd.append('n', '1');
  if (size) fd.append('size', size);
  const field = referenceImages.length > 1 ? 'image[]' : 'image';
  for (const p of referenceImages) {
    const buf = await readFile(p);
    fd.append(field, new Blob([buf]), basename(p));
  }

  const r = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd
  });
  if (!r.res.ok) {
    throw new Error(`生图接口返回 HTTP ${r.res.status}：${(r.text || '').slice(0, 500)}`);
  }
  return parseImageResponse(r);
}

async function generateImage({ prompt, destination, referenceImages }) {
  const miss = missingConfig();
  if (miss.length) {
    throw new Error(`缺少配置：${miss.join('、')}。请在 MCP 服务器的环境变量中配置后重启生效。`);
  }

  const wantsTransparent = TRANSPARENT_RE.test(prompt);
  const size = parseOversize(prompt);         // 长边 ≥ 2048 时透传 size 争取高分辨率
  const needChroma = wantsTransparent && !!size; // 大尺寸下上游无法透明 → 纯色生成+抠图
  const effPrompt = needChroma ? rewritePromptForChroma(prompt) : prompt;

  let buffer, item;
  if (referenceImages.length > 0) {
    ({ buffer, item } = await callEdits(effPrompt, referenceImages, size));
  } else {
    ({ buffer, item } = await callGenerations(effPrompt, size));
  }

  // 大尺寸+透明：输出应为纯品红背景，自动色键抠图为 RGBA
  let chromaNote = '';
  if (needChroma) {
    const isPng = buffer.subarray(0, 4).toString('hex') === '89504e47';
    if (isPng && buffer[25] === 6) {
      chromaNote = '（上游输出已含透明通道，跳过抠图）';
    } else {
      const img = decodePng(buffer);
      const rgba = chromaKeyMagenta(img.width, img.height, img.channels, img.pixels);
      buffer = encodePng(img.width, img.height, rgba);
      chromaNote = `（已自动品红色键抠图 → RGBA ${img.width}x${img.height}）`;
    }
  }

  let target = resolveDestination(destination);
  // 透明背景必须保存为 PNG：非 .png 扩展名时自动替换（目录自动命名本身就是 .png）
  if (wantsTransparent && !/\.png$/i.test(target)) {
    target = target.replace(/\.[^./\\]+$/, '') + '.png';
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);

  // 透明模式校验：PNG color type 应为 6（RGBA），否则服务商未真正输出透明通道
  let alphaNote = '';
  if (wantsTransparent) {
    const isPng = buffer.subarray(0, 4).toString('hex') === '89504e47';
    if (!isPng || buffer[25] !== 6) {
      alphaNote = '\n注意：提示词要求了透明背景，但输出不包含透明通道（PNG color type 非 RGBA），请检查提示词或服务商状态';
    }
  }

  const refNote = referenceImages.length > 0 ? `（基于 ${referenceImages.length} 张参考图）` : '';
  const sizeNote = size ? `\n已向上游透传 size=${size}${chromaNote ? '，' + chromaNote : ''}` : '';
  const extra = item.revised_prompt ? `\n服务商改写后的提示词：${item.revised_prompt}` : '';
  return `已生成图片并保存到：${target}（${(buffer.length / 1024).toFixed(1)} KB）${refNote}${sizeNote}${extra}${alphaNote}`;
}

async function handleToolCall(params) {
  const name = params?.name;
  const args = params?.arguments || {};
  if (name !== 'generate_image') {
    return toolText(`未知工具：${name}`, true);
  }
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
    return toolText('参数 prompt（图片描述）不能为空。', true);
  }
  if (typeof args.destination !== 'string' || !args.destination.trim()) {
    return toolText('参数 destination（目标保存位置）不能为空。', true);
  }
  const referenceImages = Array.isArray(args.reference_images)
    ? args.reference_images.filter((p) => typeof p === 'string' && p.trim())
    : [];
  if (referenceImages.length > 4) {
    return toolText('参考图最多 4 张。', true);
  }
  for (const p of referenceImages) {
    if (!existsSync(p.trim())) {
      return toolText(`参考图不存在：${p}`, true);
    }
  }
  if (generating) {
    return toolText('当前已有图片在生成中（本服务限制同时只生成 1 张），请等待完成后再试。', true);
  }
  if (lastGenerateStartAt > 0) {
    const elapsed = Date.now() - lastGenerateStartAt;
    if (elapsed < MIN_GENERATE_INTERVAL_MS) {
      const waitSec = Math.ceil((MIN_GENERATE_INTERVAL_MS - elapsed) / 1000);
      return toolText(`两次生图需间隔至少 10 秒（防上游限流），请等待 ${waitSec} 秒后再试。`, true);
    }
  }

  generating = true;
  lastGenerateStartAt = Date.now();
  try {
    const message = await generateImage({
      prompt: args.prompt.trim(),
      destination: args.destination,
      referenceImages: referenceImages.map((p) => p.trim())
    });
    return toolText(message);
  } catch (err) {
    const msg = err?.name === 'AbortError' ? '请求超时（超过 5 分钟）' : err?.message || String(err);
    return toolText(`生成失败：${msg}`, true);
  } finally {
    generating = false;
  }
}

const rl = readline.createInterface({ input: process.stdin });

let pendingCount = 0;
let closing = false;

function tryExit() {
  if (closing && pendingCount === 0) process.exit(0);
}

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // 通知（如 notifications/initialized），无需响应

  pendingCount++;
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
    } else if (method === 'ping') {
      reply(id, {});
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const result = await handleToolCall(params);
      reply(id, result);
    } else {
      replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    replyError(id, -32603, `Internal error: ${err?.message || err}`);
  } finally {
    pendingCount--;
    tryExit();
  }
});

// stdin 关闭后，等待未完成的请求（如正在生成的图片）结束后再退出，避免响应丢失
rl.on('close', () => {
  closing = true;
  tryExit();
});

log(`MCP 服务器已启动（stdio）。基地址：${BASE_URL || '未配置'} 模型：${MODEL || '未配置'}`);
