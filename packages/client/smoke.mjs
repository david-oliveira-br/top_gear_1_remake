// Browser smoke test: node packages/client/smoke.mjs <outDir> <url>   (needs `npm run dev` running)
import { chromium } from 'playwright';
const out = process.argv[2] || '.', URL = (process.argv[3] || 'http://localhost:5173/') + '?autopilot';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(1500);
  return p;
};
const state = (p) => p.evaluate(() => { const r = window.__rc, s = r.session, w = s.world; return { racing: r.racing, phase: w.phase, tick: w.tick, title: r.menu.top?.title, cars: w.cars.map((c) => ({ z: Math.round(c.rz), lap: c.lap, speed: Math.round(c.speed), ai: c.isAI })), local: s.local }; });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };

// 1. split-screen, mid-race
let p = await open();
await p.evaluate(() => localStorage.setItem('rc_setup', JSON.stringify({ track: 4, laps: 1, weather: 0, time: 0, grid: 12, difficulty: 1 })));
await p.reload(); await p.waitForTimeout(1200);
await p.click('text=Split-screen (2 players)'); await p.click('text=Start race');
await p.waitForTimeout(16000);
await p.screenshot({ path: out + '/10-split.png' });
let s = await state(p);
if (s.local.length !== 2 || s.local.some((i) => s.cars[i].speed < 3000)) fail('split-screen cars not moving ' + JSON.stringify(s.local.map((i) => s.cars[i])));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.screenshot({ path: out + '/11-pause.png' });
const t0 = (await state(p)).tick; await p.waitForTimeout(500);
if ((await state(p)).tick !== t0) fail('pause did not freeze the race');
await p.click('text=Quit race');

// 2. single 1-lap race through to the results screen
await p.evaluate(() => localStorage.setItem('rc_setup', JSON.stringify({ track: 7, laps: 1, weather: 0, time: 0, grid: 6, difficulty: 0 })));
await p.reload(); await p.waitForTimeout(1200);
await p.click('text=Single race'); await p.click('text=Start race');
await p.waitForTimeout(25000); await p.screenshot({ path: out + '/12-fog.png' });
await p.waitForFunction(() => window.__rc.menu.top?.title === 'Results', null, { timeout: 120000 });
await p.screenshot({ path: out + '/13-results.png' });
await p.close();

// 3. online duel between two browsers
const a = await open(), c = await open();
await a.click('text=Online multiplayer'); await a.click('text=Create 1 vs 1 duel room');
await a.waitForFunction(() => window.__rc.menu.top?.title === '1 vs 1 duel');
const code = await a.evaluate(() => document.querySelector('.code').textContent);
await c.click('text=Online multiplayer');
await c.waitForSelector(`text=Join ${code}`); await c.click(`text=Join ${code}`);
await c.waitForFunction(() => window.__rc.menu.top?.title === '1 vs 1 duel');
await a.screenshot({ path: out + '/14-lobby.png' });
await c.click('li:has-text("Ready")');
await a.waitForSelector('text=READY'); await a.click('text=Start race');
await a.waitForTimeout(20000);
const [sa, sc] = await Promise.all([state(a), state(c)]);
await a.screenshot({ path: out + '/15-online-a.png' }); await c.screenshot({ path: out + '/16-online-c.png' });
console.log('online', JSON.stringify({ a: sa.cars, c: sc.cars, la: sa.local, lc: sc.local }));
if (!sa.racing || !sc.racing || sa.cars.length !== 2) fail('online race did not start');
if (sa.cars.some((k) => k.speed < 3000) || sc.cars.some((k) => k.speed < 3000)) fail('online cars not moving');
for (const i of [0, 1]) if (Math.abs(sa.cars[i].z - sc.cars[i].z) > 6000) fail(`clients disagree on car ${i}: ${sa.cars[i].z} vs ${sc.cars[i].z}`);
await c.context().close();
await a.waitForFunction((i) => window.__rc.session.world.cars[i].isAI, sc.local[0], { timeout: 10000 }).catch(() => fail('leaver car was not handed to AI'));
console.log('errors', errs); if (errs.length) process.exitCode = 1;
await b.close();
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
