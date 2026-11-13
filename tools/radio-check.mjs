// Check every preset radio station plays in a real browser, then the fallback and the R key.
// Copy next to playwright-core (see tools/wsmoke.sh) and run with Windows node; needs the dev server on :5174.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const ids = ['melodeath', 'tuneria', 'orbita24', 'radium'];
const run = async (label, setup, after) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5174/'); await page.evaluate(setup); await page.reload();
  await page.waitForFunction('window.__ready', null, { timeout: 120000 }); await page.mouse.click(640, 360);
  let beats = [], r = {};
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); r = await page.evaluate('({p: window.__app.radio.playing, b: window.__app.radio.beat(), t: window.__app.radio.el ? window.__app.radio.el.currentTime : -1, n: window.__app.radio.name, e: window.__app.radio.error, s: window.__app.audio.current})'); if (r.p) beats.push(+r.b.toFixed(2)); if (beats.length >= 12 || (!r.p && r.e)) break; }
  console.log(label.padEnd(10), r.p ? 'PLAYING' : 'FAILED ', 'time', r.t.toFixed(1), 'beat', beats.slice(2).join(','), r.e || '', 'synth:', JSON.stringify(r.s));
  if (after) await after(page); await page.close();
};
for (const id of ids) await run(id, `localStorage.setItem('rh_radio', JSON.stringify({station:'${id}'}))`);
await run('dead', () => localStorage.setItem('rh_radio', JSON.stringify({ station: 'custom', url: 'https://localhost:1/none.mp3', name: 'Morta' })));
await run('R key', () => localStorage.clear(), async (page) => {
  const seq = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('r'); await page.waitForTimeout(1200); seq.push(await page.evaluate('window.__app.settings.radioOn ? window.__app.radio.station : "game"')); }
  console.log('R cycle  ', seq.join(' > '));
});
await browser.close();
