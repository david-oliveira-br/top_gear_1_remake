// Plays every song for a few seconds in headless Chromium and reports output level.  node packages/client/audiocheck.mjs <url>
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL); await p.waitForTimeout(1500);
await p.mouse.click(5, 5); await p.waitForTimeout(300);
const names = await p.evaluate(async () => Object.keys((await import('/src/audio/songs.ts')).SONGS));
let bad = 0;
for (const n of names) {
  const r = await p.evaluate(async (n) => {
    const a = window.__rc.audio; a.unlock(); a.play(n);
    let peak = 0, sum = 0, k = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 14000) { const l = a.level(); peak = Math.max(peak, l.peak); sum += l.rms; k++; await new Promise((r) => setTimeout(r, 40)); }
    return { peak: +peak.toFixed(2), rms: +(sum / k).toFixed(3), state: a.ctx.state };
  }, n);
  const ok = r.rms > 0.01 && r.peak < 1;
  if (!ok) bad++;
  console.log(n.padEnd(10), JSON.stringify(r), ok ? '' : '<-- check');
}
console.log('errors', errs); await b.close();
process.exitCode = bad || errs.length ? 1 : 0;
