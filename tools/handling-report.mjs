// Prints handling metrics per car at 60/100/180 km/h. Bundles packages/sim/test/handling-metrics.ts in memory with esbuild.
// Usage: node tools/handling-report.mjs [--out file]
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = await build({ entryPoints: [root + 'packages/sim/test/handling-metrics.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18' });
const code = 'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64');
const M = await import(code);
const bundleSim = async () => 'data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [root + 'packages/sim/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text).toString('base64');
const sim = await import(await bundleSim());
const { CARS } = sim;

// Columns: SIM = current physics (no preset). Hook: once packages/sim/src exports `ARCADE` (Handling), add { label: 'ARCADE', h: ARCADE, ramp: M.arcadeRamp }.
const columns = [{ label: 'SIM', h: undefined, ramp: M.simRamp }];
if (sim.ARCADE) columns.push({ label: 'ARCADE', h: sim.ARCADE, ramp: M.arcadeRamp });

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'inf');
const kmh = M.kmh;
const rows = (spec, v, h, ramp) => {
  const hb = M.handbrake(spec, kmh(v), 0.7, h), hold = M.keyHold(spec, kmh(v), h, ramp);
  return [
    ['tap0.25s heading deg', f(M.keyTap(spec, kmh(v), 0.25, h, ramp))],
    ['keyHold yaw overshoot', f(hold.overshoot, 2)],
    ['keyHold max beta deg', f(hold.maxBeta * 180 / Math.PI)],
    ['handbrake0.7 peak deg', f(hb.peak)],
    ['handbrake0.7 yaw deg', f(hb.yaw, 0)],
    ['hb yaw, steer kept deg', f(M.handbrake(spec, kmh(v), 0.7, h, true).yaw, 0)],
    ['handbrake recover s', f(hb.recover, 2)],
    ['brakeInTurn peak deg', f(M.brakeInTurn(spec, kmh(v), h))],
    ['powerOn peak deg', f(M.powerOn(spec, kmh(v), h))],
    ['lockShare 25%', f(M.lockShare(spec, kmh(v), 0.25, h), 2)],
    ['lockShare 50%', f(M.lockShare(spec, kmh(v), 0.5, h), 2)],
    ['understeer deg/g', f(M.understeerGradient(spec, kmh(v), h), 2)],
    ['step overshoot (raw)', f(M.steadyOvershoot(spec, kmh(v), h), 2)],
    ['wall 3deg speed loss %', f(M.wallGraze(spec, kmh(v), 3, h), 0)],
    ['wall 8deg speed loss %', f(M.wallGraze(spec, kmh(v), 8, h), 0)],
    ['wall 20deg speed loss %', f(M.wallGraze(spec, kmh(v), 20, h), 0)],
  ];
};
const speeds = [60, 100, 180];
let out = '';
for (const car of CARS) {
  out += `\n== ${car.id} (${car.name}) ==\n`;
  const per = columns.map((c) => speeds.map((v) => rows(car.spec, v, c.h, c.ramp)));
  const head = 'metric'.padEnd(26) + columns.map((c) => speeds.map((v) => `${c.label}@${v}`.padStart(11)).join('')).join('  ');
  out += head + '\n';
  per[0][0].forEach(([name], i) => { out += name.padEnd(26) + per.map((p) => p.map((r) => r[i][1].padStart(11)).join('')).join('  ') + '\n'; });
}
console.log(out);
const o = process.argv.indexOf('--out'); if (o > 0) writeFileSync(process.argv[o + 1], out);
