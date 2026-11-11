// Visual review helper: node packages/client/gallery.mjs <outDir> <url> [trackIndex...]
import { chromium } from 'playwright';
const out = process.argv[2] || '.', URL = (process.argv[3] || 'http://localhost:5173/') + '?autopilot';
const tracks = process.argv.slice(4).map(Number);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL); await p.waitForTimeout(1500);
await p.click('text=Single race'); await p.click('li:has(.label:text-is("Car"))'); await p.waitForTimeout(400);
await p.screenshot({ path: out + '/g-showroom.png' });
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
await p.screenshot({ path: out + '/g-showroom2.png' });
for (const t of tracks) {
  await p.evaluate((t) => localStorage.setItem('rc_setup', JSON.stringify({ track: t, laps: 1, weather: 0, time: 0, grid: 12, difficulty: 1 })), t);
  await p.reload(); await p.waitForTimeout(1200);
  await p.click('text=Single race'); await p.click('text=Start race');
  await p.waitForTimeout(1500); await p.screenshot({ path: out + `/g-${t}-intro.png` });
  await p.waitForTimeout(13500); await p.screenshot({ path: out + `/g-${t}.png` });
}
console.log('errors', errs);
await b.close();
