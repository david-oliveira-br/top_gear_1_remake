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
if (errors.length) await fail('page errors');
console.log('SMOKE OK'); await browser.close();
