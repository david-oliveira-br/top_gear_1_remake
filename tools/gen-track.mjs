// Turtle track generator. Usage: node tools/gen-track.mjs <id>  (route in tools/routes/<id>.mjs)
// Prints integer [x,z,h] literals to paste into packages/sim/src/track.ts, plus section markers (arc length, height) and checks.
// The turtle starts at the origin heading -z. arc(radius, deg, grade): positive deg turns right (towards +x when heading -z).
// grade is rise per metre of path. mark(name) records the arc length / height for the bridge, gallery, overpass ranges.
function Turtle(h0) {
  let x = 0, z = 0, hd = 0, y = h0, s = 0; const pts = [[0, 0, h0]], marks = [], cuts = [[0, 0]];
  const push = () => { pts.push([Math.round(x), Math.round(z), Math.round(y)]); };
  const api = {
    straight(len, grade = 0) {
      const n = Math.max(1, Math.ceil(len / 90)), d = len / n;
      for (let i = 0; i < n; i++) { x += Math.sin(hd) * d; z -= Math.cos(hd) * d; y += grade * d; s += d; push(); }
      return api;
    },
    arc(radius, deg, grade = 0) {
      const a = Math.abs(deg) * Math.PI / 180, sg = Math.sign(deg), maxStep = radius < 100 ? 0.62 : Math.min(0.5, 90 / radius);
      const n = Math.max(1, Math.ceil(a / maxStep)), da = a / n, chord = 2 * radius * Math.sin(da / 2), d = radius * da;
      for (let i = 0; i < n; i++) {
        hd += sg * da / 2; x += Math.sin(hd) * chord; z -= Math.cos(hd) * chord; hd += sg * da / 2; y += grade * d; s += d; push();
      }
      return api;
    },
    mark(name) { marks.push([name, Math.round(s), Math.round(y)]); return api; },
    done() { return { pts, marks, len: s }; },
  };
  return api;
}

// Routes live in tools/routes/<id>.mjs: `export default function route(Turtle) { const t = Turtle(h0); ...; return t.done(); }`
const routes = new Proxy({}, { get: (_, id) => async () => (await import(new URL(`./routes/${String(id)}.mjs`, import.meta.url))).default(Turtle) });

const which = process.argv[2] ?? 'rockies';
const { pts, marks, len } = await routes[which]();
// sanity checks on the raw polyline
let minGap = Infinity;
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (cum[j] - cum[i] > 120) minGap = Math.min(minGap, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
console.error(`${which}: length ${len.toFixed(0)} m, height ${lo}..${hi}, min separation ${minGap.toFixed(0)} m, end x/z ${pts.at(-1)[0]},${pts.at(-1)[1]}`);
for (const m of marks) console.error(`  ${m[0]} s=${m[1]} h=${m[2]}`);
const out = []; for (let i = 0; i < pts.length; i += 8) out.push('    ' + pts.slice(i, i + 8).map((p) => `[${p.join(', ')}]`).join(', ') + ',');
console.log(out.join('\n'));
