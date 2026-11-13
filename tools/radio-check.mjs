import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const run = async (label, setup) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5174/'); await page.evaluate(setup); await page.reload();
  await page.waitForFunction('window.__ready', null, { timeout: 120000 });
  await page.mouse.click(640, 360);
  let playing = false, beats = [];
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(500); const r = await page.evaluate('({p: window.__app.radio.playing, b: window.__app.radio.beat(), e: window.__app.radio.error, n: window.__app.radio.name, s: window.__app.audio.current})'); if (r.p) { playing = true; beats.push(+r.b.toFixed(2)); } if (beats.length >= 12) break; if (i === 29 || (!r.p && r.e)) console.log(label, 'state', JSON.stringify(r)); }
  const fin = await page.evaluate('({p: window.__app.radio.playing, e: window.__app.radio.error, s: window.__app.audio.current, t: window.__app.radio.el ? window.__app.radio.el.currentTime : -1})');
  console.log(label, 'playing', playing, 'beats', beats.join(','), JSON.stringify(fin)); await page.close();
};
await run('default station', () => localStorage.clear());
await run('dead station', () => localStorage.setItem('rh_radio', JSON.stringify({ station: 'custom', url: 'https://localhost:1/none.mp3', name: 'Morta' })));
await browser.close();
