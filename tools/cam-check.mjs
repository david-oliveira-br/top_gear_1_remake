// Camera keys on a real browser: C cycles the five views, holding B looks back. Run: cp to rl-shot and `node.exe cam-check.mjs` (dev server on :5174).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2] || 'out/camkeys'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5174/?go=race&ev=rio-sprint&auto=1&t=25'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction('window.__ready', null, { timeout: 120000 }); await page.waitForTimeout(1500);
const cam = () => page.evaluate('window.__app.session.cam'); const seen = [await cam()];
for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyC'); await page.waitForTimeout(500); seen.push(await cam()); await page.screenshot({ path: `${out}/c${i}_${seen[seen.length - 1]}.png` }); }
console.log('cycle', seen.join(' > '), 'saved', await page.evaluate('JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>/settings/i.test(k)))||"{}").cam'));
for (const m of ['chase', 'cockpit']) {
  await page.evaluate((m) => { window.__app.session.cam = m; }, m); await page.waitForTimeout(500);
  await page.keyboard.down('KeyB'); await page.waitForTimeout(700); console.log(m, 'lookBack', await page.evaluate('window.__app.session.lookBack'));
  await page.screenshot({ path: `${out}/back_${m}.png` }); await page.keyboard.up('KeyB'); await page.waitForTimeout(300);
  console.log(m, 'released', await page.evaluate('window.__app.session.lookBack'));
}
console.log(errors.length ? 'ERRORS ' + errors.join('|') : 'no page errors');
await browser.close();
