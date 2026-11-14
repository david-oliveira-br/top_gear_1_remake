import { getBounds } from '@gltf-transform/functions';
export function triCount(mesh) {
  let t = 0;
  for (const p of mesh.listPrimitives()) {
    const i = p.getIndices();
    t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return t;
}
const f = (v) => v.map((x) => x.toFixed(3)).join(',');
export function inspectDoc(doc, { wheelRe = /wheel|tyre|tire|(^|[^a-z])rim|rotor|caliper|disc|hub/i } = {}) {
  const scene = doc.getRoot().listScenes()[0];
  let total = 0;
  const mats = new Map();
  const walk = (n, d, path) => {
    const m = n.getMesh();
    if (d < 4 && !m) {
      const s = n.getScale(), t = n.getTranslation();
      console.log(`${'  '.repeat(d)}${n.getName()} kids=${n.listChildren().length} T[${f(t)}] S[${f(s)}]`);
    }
    if (m) {
      const t = triCount(m);
      total += t;
      const b = getBounds(n);
      for (const p of m.listPrimitives()) {
        const mn = p.getMaterial()?.getName() ?? '?';
        const e = mats.get(mn) ?? { tris: 0, n: 0 };
        e.tris += triCount({ listPrimitives: () => [p] });
        e.n++;
        mats.set(mn, e);
      }
      if (wheelRe.test(path.join('/')) )
        console.log(`  W ${n.getName()} tris=${t} [${f(b.min)}]..[${f(b.max)}] mat=${m.listPrimitives().map((p) => p.getMaterial()?.getName()).join('|')}`);
    }
    n.listChildren().forEach((c) => walk(c, d + 1, [...path, n.getName()]));
  };
  scene.listChildren().forEach((n) => walk(n, 0, []));
  const b = getBounds(scene);
  console.log('TOTAL tris', total, 'bounds', f(b.min), f(b.max));
  for (const [k, v] of mats) console.log('  mat', k, 'tris', v.tris, 'prims', v.n);
}
