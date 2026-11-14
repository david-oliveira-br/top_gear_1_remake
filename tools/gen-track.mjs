// Turtle track generator. Usage: node tools/gen-track.mjs [rockies|patagonia]
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

const routes = {
  rockies() {
    const t = Turtle(42);
    t.straight(120, 0.01);
    // lakeshore sweepers
    t.arc(320, 24, 0.012).arc(260, -34, 0.014).arc(380, 28, 0.01).straight(60, 0.01).arc(300, -26, 0.012).arc(220, 30, 0.01).straight(40, 0.01);
    t.mark('overpass-start').straight(140, 0.03).mark('overpass-end');
    // forest straight with a gentle drift, avalanche gallery on the straight
    t.straight(140, 0.03).arc(900, -8, 0.03).straight(120, 0.03).mark('gallery-start').straight(220, 0.03).mark('gallery-end');
    t.straight(60, 0.03).arc(500, 14, 0.05).arc(450, -12, 0.06).straight(200, 0.06).arc(260, 22, 0.06).arc(300, -24, 0.06).straight(120, 0.06);
    // four stacked hairpins
    t.mark('hairpins-start');
    t.straight(140, 0.075).arc(46, 180, 0.08).straight(170, 0.08).arc(46, -180, 0.08).straight(170, 0.08).arc(46, 180, 0.08).straight(170, 0.08).arc(46, -180, 0.08);
    t.straight(200, 0.04).mark('hairpins-end');
    // fast bench, then the gorge bridge on flat ground
    t.arc(500, -18, 0.0).arc(500, 14, 0.0).straight(300, 0).mark('bridge-run-start').straight(380, 0).mark('bridge-run-end').straight(100, 0);
    // snowfield pass
    t.arc(420, 22, 0.05).arc(380, -26, 0.055).straight(240, 0.055).arc(300, 20, 0.05).arc(320, -24, 0.045).straight(320, 0.065).arc(500, 10, 0.05).straight(120, 0.03);
    t.straight(480, 0.0);
    return t.done();
  },
  patagonia() {
    const t = Turtle(115);
    t.straight(120, 0);
    // steppe straights with blind crests
    t.straight(260, 0.03).straight(300, -0.045).arc(1200, 9, -0.02).straight(240, 0.03).straight(300, -0.055).arc(1100, -7.3, -0.02).straight(200, 0.02).straight(300, -0.06).straight(250, -0.05);
    t.arc(1000, 8.4, -0.05).straight(360, -0.05);
    // glacier lake bridge on flat ground
    t.straight(60, 0).mark('bridge-run-start').straight(260, 0).mark('bridge-run-end').straight(60, 0);
    // lenga forest esses
    t.arc(130, 55, 0.02).arc(110, -75, 0.02).straight(60, 0.02).arc(120, 70, 0.025).arc(100, -80, 0.025).straight(50, 0.02).arc(140, 60, 0.02).arc(120, -65, 0.02).straight(80, 0.02).arc(110, 70, 0.025).arc(130, -60, 0.02).straight(120, 0.03);
    // moraine climb with two hairpins
    t.arc(500, -14, 0.06).straight(200, 0.06).arc(400, 14, 0.06).straight(100, 0.07).mark('hairpins-start');
    t.arc(46, 180, 0.08).straight(190, 0.08).arc(46, -180, 0.08).straight(240, 0.07).arc(600, 18, 0.06).straight(240, 0.07);
    t.arc(450, -16, 0.06).straight(200, 0.05).arc(500, 14, 0.04).straight(120, 0.03);
    // run toward the granite towers
    t.straight(560, 0.0);
    return t.done();
  },
};

const which = process.argv[2] ?? 'rockies';
const { pts, marks, len } = routes[which]();
// sanity checks on the raw polyline
let minGap = Infinity;
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (cum[j] - cum[i] > 120) minGap = Math.min(minGap, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
console.error(`${which}: length ${len.toFixed(0)} m, height ${lo}..${hi}, min separation ${minGap.toFixed(0)} m, end x/z ${pts.at(-1)[0]},${pts.at(-1)[1]}`);
for (const m of marks) console.error(`  ${m[0]} s=${m[1]} h=${m[2]}`);
const out = []; for (let i = 0; i < pts.length; i += 8) out.push('    ' + pts.slice(i, i + 8).map((p) => `[${p.join(', ')}]`).join(', ') + ',');
console.log(out.join('\n'));
