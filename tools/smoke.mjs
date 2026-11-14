// End-to-end check on a real browser: race to the flag, bank the prize, buy a part, see the map.
// Run with Windows Chrome via tools/wsmoke.sh (needs the dev server on :5174).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const info = () => page.evaluate('window.__info');
const fail = async (m) => { console.log('SMOKE FAIL: ' + m, errors.slice(0, 5)); await browser.close(); process.exit(1); };
await page.goto('http://localhost:5174/?go=race&ev=rio-sprint&auto=1&t=275'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction('window.__ready', null, { timeout: 120000 });
await page.waitForFunction('window.__info && window.__info.screen === "results"', null, { timeout: 120000 }).catch(() => {});
let i = await info(); if (i.screen !== 'results') await fail('race did not reach the results screen: ' + JSON.stringify(i));
if (!(i.money > 2500 && i.rep > 0)) await fail('no prize banked: ' + JSON.stringify(i));
console.log('race finished, place', i.place, 'money', i.money, 'rep', i.rep);
await page.click('text=Garagem'); await page.waitForFunction('window.__info.screen === "garage"');
const before = (await info()).money; await page.click('.part button.pri'); await page.waitForTimeout(400);
const after = (await info()).money; if (!(after < before)) await fail('buying a part did not spend money');
console.log('bought a part:', before, '->', after);
await page.click('text=World Tour'); await page.waitForFunction('window.__info.screen === "map"'); await page.click('.cities >> text=Tóquio'); await page.waitForTimeout(2500);
if (!(await page.locator('text=Em breve').count())) await fail('locked city panel missing');
await page.click('.cities >> text=Rio de Janeiro'); await page.waitForTimeout(600); await page.click('.ev button.pri >> nth=1'); await page.waitForFunction('window.__info.screen === "race"');
await page.waitForTimeout(6000); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(5000); await page.keyboard.up('ArrowUp');
const sp = await page.evaluate('Math.abs(window.__app.session.me.car.vx) * 3.6'); if (!(sp > 30)) await fail('keyboard throttle did not move the car: ' + sp);
console.log('time trial: drove to', Math.round(sp), 'km/h; fps', await page.evaluate('window.__fps'));
// Big Sur: the point-to-point coast race, autopilot to the results screen (t= skips ahead), prize credited
await page.goto('http://localhost:5174/?go=race&ev=coast-run&auto=1&t=150&rep=40'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction('window.__ready', null, { timeout: 180000 });
const ci = await info(); if (ci.track !== 'coast') await fail('coast world did not load: ' + JSON.stringify(ci));
await page.waitForFunction('window.__info && window.__info.screen === "results"', null, { timeout: 120000 }).catch(() => {});
let c = await info(); if (c.screen !== 'results') await fail('coast race did not reach the results screen: ' + JSON.stringify(c));
if (!(c.money > 2500 && c.rep > 0)) await fail('coast: no prize banked: ' + JSON.stringify(c));
console.log('coast race finished, place', c.place, 'money', c.money, 'rep', c.rep, 'fps', await page.evaluate('window.__fps'));
// rockies: autopilot to the results screen on the stub/real world
await page.goto('http://localhost:5174/?go=race&ev=rockies-run&auto=1&t=126&rep=100'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction('window.__ready', null, { timeout: 180000 });
const roi = await info(); if (roi.track !== 'rockies') await fail('rockies world did not load: ' + JSON.stringify(roi));
await page.waitForFunction('window.__info && window.__info.screen === "results"', null, { timeout: 120000 }).catch(() => {});
const ror = await info(); if (ror.screen !== 'results') await fail('rockies race did not reach the results screen: ' + JSON.stringify(ror));
if (!(ror.money > 2500 && ror.rep > 0)) await fail('rockies: no prize banked: ' + JSON.stringify(ror));
console.log('rockies race finished, place', ror.place, 'money', ror.money, 'rep', ror.rep, 'fps', await page.evaluate('window.__fps'));
// patagonia: autopilot to the results screen on the stub/real world
await page.goto('http://localhost:5174/?go=race&ev=pata-run&auto=1&t=130&rep=200'); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForFunction('window.__ready', null, { timeout: 180000 });
const pai = await info(); if (pai.track !== 'patagonia') await fail('patagonia world did not load: ' + JSON.stringify(pai));
await page.waitForFunction('window.__info && window.__info.screen === "results"', null, { timeout: 120000 }).catch(() => {});
const par = await info(); if (par.screen !== 'results') await fail('patagonia race did not reach the results screen: ' + JSON.stringify(par));
if (!(par.money > 2500 && par.rep > 0)) await fail('patagonia: no prize banked: ' + JSON.stringify(par));
console.log('patagonia race finished, place', par.place, 'money', par.money, 'rep', par.rep, 'fps', await page.evaluate('window.__fps'));
if (errors.length) await fail('page errors');
console.log('SMOKE OK'); await browser.close();
