// Capture screenshots of the running dev server. usage: node tools/shot.mjs <outDir> <name>=<query> ...
// env: WAIT (ms after ready, default 1500), W/H (viewport), SW=1 forces software WebGPU
import { chromium } from 'playwright';
import fs from 'node:fs';
const [outDir, ...shots] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
if (process.env.SW) args.push('--use-webgpu-adapter=swiftshader');
const browser = await chromium.launch({ args, executablePath: process.env.CHROME || undefined, headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1600), height: +(process.env.H || 900) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)));
for (const s of shots) {
  const i = s.indexOf('='); const name = i < 0 ? s : s.slice(0, i), q = i < 0 ? '' : s.slice(i + 1);
  await page.goto((process.env.URL || 'http://localhost:5174/') + '?' + q);
  await page.waitForFunction('window.__ready', null, { timeout: +(process.env.TIMEOUT || 90000) }).catch(() => console.log('not ready: ' + name));
  await page.waitForTimeout(+(process.env.WAIT || 1500));
  const info = await page.evaluate('JSON.stringify({backend:window.__backend,fps:window.__fps,info:window.__info})');
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, info);
}
await browser.close();
