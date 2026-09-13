// 最后验证：不带 response_format 请求，检查响应字段结构；若有 url 则下载验证 alpha
const key = '***REMOVED***';

const res = await fetch('https://api.denxio.com/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'gpt-image-2.5-sunburst',
    prompt:
      'a red six-sided game dice, flat design, isolated on a fully transparent background, ' +
      'no backdrop, no scene, PNG with alpha channel',
    n: 1,
    size: '1024x1024'
  })
});
const text = await res.text();
console.log('HTTP', res.status);
const json = JSON.parse(text);
const item = json.data?.[0];
console.log('data[0] 字段:', Object.keys(item || {}));
if (item?.url) {
  console.log('url:', item.url.slice(0, 120));
  const img = await fetch(item.url);
  const ab = await img.arrayBuffer();
  const buf = Buffer.from(ab);
  const magic = buf.subarray(0, 4).toString('hex');
  console.log(`下载 ${buf.length} bytes, 魔数=${magic}`, magic === '89504e47' ? `color type=${buf[25]}${buf[25] === 6 ? ' (RGBA!)' : ''}` : '');
}
if (item?.b64_json) {
  const buf = Buffer.from(item.b64_json, 'base64');
  console.log('b64版本:', buf.subarray(0, 4).toString('hex'), 'color type =', buf[25]);
}
