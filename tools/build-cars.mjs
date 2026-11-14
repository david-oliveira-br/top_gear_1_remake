#!/usr/bin/env node
// Builds game-ready car GLBs from the Sketchfab zips in assets/.
//   node tools/build-cars.mjs [--inspect] [--keep] [id ...]
// Output: packages/game/public/assets/cars/<id>.glb (+ licenses/<id>.txt)
//         packages/game/src/car/models.gen.json
// Zips are untrusted: each is extracted into a fresh assets/.work/<id>/ by `unzip` run from the repo root.
// NOTE: deliberately does NOT use gltf-transform `optimize` (it flattens/renames nodes).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weldPrimitive, simplifyPrimitive, compactPrimitive, textureCompress, quantize, reorder, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { CARS } from './cars.config.mjs';
import { inspectDoc } from './cars-inspect.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const ids = args.filter((a) => !a.startsWith('--'));
const outDir = path.join(root, 'packages/game/public/assets/cars');
const genPath = path.join(root, 'packages/game/src/car/models.gen.json');
const MAX_BYTES = 3 * 1024 * 1024;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function unzip(id) {
  const dir = path.join(root, 'assets/.work', id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', path.join(root, 'assets', CARS[id].zip), '-d', dir], { cwd: root });
  return dir;
}

// ---------- small math ----------
function inv3(m) { // m: row-major 3x3 [a b c; d e f; g h i]
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return { m: r.map((x) => x / det), det };
}

function readAttr(acc) {
  const n = acc.getCount(), sz = acc.getElementSize();
  const out = new Float32Array(n * sz);
  const el = new Array(sz).fill(0);
  const norm = acc.getNormalized();
  const div = norm ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.getComponentType()] : 1;
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let k = 0; k < sz; k++) out[i * sz + k] = norm ? Math.max(el[k] / div, -1) : el[k]; }
  return out;
}

// ---------- 1. flatten scene into world-space parts ----------
const KEEP = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT', 'COLOR_0'];
function collectParts(doc, cfg) {
  const parts = [];
  const scene = doc.getRoot().listScenes()[0];
  const walk = (node, names) => {
    const nm = [...names, node.getName()];
    if (cfg.drop && nm.some((n) => cfg.drop.test(n))) return;
    const mesh = node.getMesh();
    if (mesh) {
      const w = node.getWorldMatrix(); // column-major
      const M = [w[0], w[4], w[8], w[1], w[5], w[9], w[2], w[6], w[10]]; // row-major 3x3
      const { m: Mi, det } = inv3(M);
      const NM = [Mi[0], Mi[3], Mi[6], Mi[1], Mi[4], Mi[7], Mi[2], Mi[5], Mi[8]]; // inverse transpose
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4 || !prim.getAttribute('POSITION')) continue;
        const attrs = {};
        for (const sem of KEEP) {
          const acc = prim.getAttribute(sem);
          if (!acc) continue;
          attrs[sem] = { size: acc.getElementSize(), data: readAttr(acc) };
        }
        const P = attrs.POSITION.data;
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          P[i] = w[0] * x + w[4] * y + w[8] * z + w[12];
          P[i + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
          P[i + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        }
        const xf = (arr, mat, off) => {
          for (let i = 0; i < arr.size * (arr.data.length / arr.size); i += arr.size) {
            const x = arr.data[i], y = arr.data[i + 1], z = arr.data[i + 2];
            let a = mat[0] * x + mat[1] * y + mat[2] * z, b = mat[3] * x + mat[4] * y + mat[5] * z, c = mat[6] * x + mat[7] * y + mat[8] * z;
            const l = Math.hypot(a, b, c) || 1;
            arr.data[i] = a / l; arr.data[i + 1] = b / l; arr.data[i + 2] = c / l;
          }
        };
        if (attrs.NORMAL) xf(attrs.NORMAL, NM);
        if (attrs.TANGENT) { xf(attrs.TANGENT, M); if (det < 0) for (let i = 3; i < attrs.TANGENT.data.length; i += 4) attrs.TANGENT.data[i] *= -1; }
        const ia = prim.getIndices();
        const n = attrs.POSITION.data.length / 3;
        let idx = ia ? Uint32Array.from(ia.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
        if (det < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
        parts.push({ name: node.getName(), path: nm.join('/'), mat: prim.getMaterial(), matName: prim.getMaterial()?.getName() ?? '', attrs, idx });
      }
    }
    node.listChildren().forEach((c) => walk(c, nm));
  };
  scene.listChildren().forEach((n) => walk(n, []));
  return parts;
}

// split a part into connected components (by shared vertices)
function islands(part) {
  const n = part.attrs.POSITION.data.length / 3;
  const par = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const idx = part.idx;
  // vertices at the same position are the same point (sources are often fully unwelded)
  const seen = new Map();
  const P = part.attrs.POSITION.data;
  const bb = partBounds(part);
  const q = 1 / (Math.max(bb.mx[0] - bb.mn[0], bb.mx[1] - bb.mn[1], bb.mx[2] - bb.mn[2], 1e-9) * 1e-4);
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(P[v * 3] * q)},${Math.round(P[v * 3 + 1] * q)},${Math.round(P[v * 3 + 2] * q)}`;
    const o = seen.get(k);
    if (o === undefined) seen.set(k, v); else par[v] = o;
  }
  for (let i = 0; i < idx.length; i += 3) {
    const a = find(idx[i]), b = find(idx[i + 1]), c = find(idx[i + 2]);
    par[b] = a; par[find(c)] = a;
  }
  const groups = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const r = find(idx[i]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  if (groups.size === 1) return [part];
  const out = [];
  for (const tris of groups.values()) {
    const remap = new Map();
    const ni = new Uint32Array(tris.length * 3);
    let k = 0;
    for (const t of tris) for (let j = 0; j < 3; j++) {
      const v = idx[t + j];
      let r = remap.get(v);
      if (r === undefined) { r = remap.size; remap.set(v, r); }
      ni[k++] = r;
    }
    const attrs = {};
    for (const [sem, a] of Object.entries(part.attrs)) {
      const d = new Float32Array(remap.size * a.size);
      for (const [o, nIdx] of remap) for (let c = 0; c < a.size; c++) d[nIdx * a.size + c] = a.data[o * a.size + c];
      attrs[sem] = { size: a.size, data: d };
    }
    out.push({ ...part, attrs, idx: ni });
  }
  return out;
}

function partBounds(p) {
  const d = p.attrs.POSITION.data;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], d[i + k]); mx[k] = Math.max(mx[k], d[i + k]); }
  return { mn, mx };
}
function unionBounds(ps) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of ps) { const b = partBounds(p); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.mn[k]); mx[k] = Math.max(mx[k], b.mx[k]); } }
  return { mn, mx };
}

// apply an affine (rotate about y / scale / translate) to a part in place
function xformParts(ps, fn) {
  for (const p of ps) {
    const P = p.attrs.POSITION.data;
    for (let i = 0; i < P.length; i += 3) { const r = fn.pos(P[i], P[i + 1], P[i + 2]); P[i] = r[0]; P[i + 1] = r[1]; P[i + 2] = r[2]; }
    for (const s of ['NORMAL', 'TANGENT']) {
      const a = p.attrs[s]; if (!a) continue;
      for (let i = 0; i < a.data.length; i += a.size) { const r = fn.dir(a.data[i], a.data[i + 1], a.data[i + 2]); a.data[i] = r[0]; a.data[i + 1] = r[1]; a.data[i + 2] = r[2]; }
    }
  }
}

// ---------- 2. rebuild a clean document ----------
function mergeToMesh(doc, buffer, name, ps, matMap) {
  const byMat = new Map();
  for (const p of ps) { const k = matMap(p.mat); if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(p); }
  const mesh = doc.createMesh(name);
  for (const [mat, list] of byMat) {
    const sems = KEEP.filter((s) => list.every((p) => p.attrs[s]));
    const nV = list.reduce((a, p) => a + p.attrs.POSITION.data.length / 3, 0);
    const nI = list.reduce((a, p) => a + p.idx.length, 0);
    const prim = doc.createPrimitive().setMaterial(mat);
    for (const s of sems) {
      const size = list[0].attrs[s].size;
      const arr = new Float32Array(nV * size);
      let o = 0;
      for (const p of list) { arr.set(p.attrs[s].data, o); o += p.attrs[s].data.length; }
      prim.setAttribute(s, doc.createAccessor().setType({ 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' }[size]).setArray(arr).setBuffer(buffer));
    }
    const ia = new Uint32Array(nI);
    let io_ = 0, vo = 0;
    for (const p of list) { for (let i = 0; i < p.idx.length; i++) ia[io_ + i] = p.idx[i] + vo; io_ += p.idx.length; vo += p.attrs.POSITION.data.length / 3; }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ia).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  return mesh;
}

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const triOf = (m) => m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);

async function buildCar(id, cfg, workDir) {
  const src = await io.read(path.join(workDir, 'scene.gltf'));
  const log = [];
  const doc = src;
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  let parts = collectParts(doc, cfg);

  // classify
  const wheelParts = [], bodyParts = [];
  for (const p of parts) (cfg.wheel(p) ? wheelParts : bodyParts).push(p);
  let wIslands = wheelParts.flatMap((p) => islands(p));
  if (!cfg.staticWheels && wIslands.length < 4) throw new Error(`${id}: only ${wIslands.length} wheel islands`);

  // yaw so the front faces +z, then scale, via wheel positions
  const yaw = {
    '+z': { pos: (x, y, z) => [x, y, z] },
    '-z': { pos: (x, y, z) => [-x, y, -z] },
    '+x': { pos: (x, y, z) => [-z, y, x] }, // +x -> +z, +z -> -x
    '-x': { pos: (x, y, z) => [z, y, -x] },
  }[cfg.front];
  yaw.dir = yaw.pos;
  const all = [...bodyParts, ...wIslands];
  xformParts(all, yaw);

  // measure wheelbase from wheel island centroids (tyres only when identifiable)
  const centre = (p) => { const b = partBounds(p); return [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2]; };
  if (process.env.DEBUG_ISLANDS) for (const p of wIslands) { const b = partBounds(p); console.log('  isl', p.path.slice(-40), p.matName, p.idx.length / 3, b.mn.map((v) => v.toFixed(2)).join(','), '..', b.mx.map((v) => v.toFixed(2)).join(',')); }
  const tyreIs = wIslands.filter((p) => cfg.tyre(p));
  if (!tyreIs.length && !cfg.staticWheels) throw new Error(`${id}: no tyre islands`);
  const cen = tyreIs.map(centre);
  const mx = cen.reduce((a, c) => a + c[0], 0) / cen.length, mz = cen.reduce((a, c) => a + c[2], 0) / cen.length;
  const cornerOf = (c) => (c[2] > mz ? 'F' : 'R') + (c[0] > mx ? 'L' : 'R'); // +x is the car's left when +z is forward
  const tyreByCorner = {};
  tyreIs.forEach((p, i) => { (tyreByCorner[cornerOf(cen[i])] ??= []).push(p); });
  for (const c of CORNERS) if (!tyreByCorner[c]?.length) throw new Error(`${id}: no tyre for ${c}`);
  const hubRaw = {};
  for (const c of CORNERS) { const b = unionBounds(tyreByCorner[c]); hubRaw[c] = [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2, (b.mx[1] - b.mn[1]) / 2, b.mn[1]]; }
  const wbRaw = (hubRaw.FL[2] + hubRaw.FR[2]) / 2 - (hubRaw.RL[2] + hubRaw.RR[2]) / 2;
  const scale = cfg.realWheelbase / wbRaw;
  log.push(`measured wheelbase ${wbRaw.toFixed(3)} -> scale ${scale.toFixed(4)}`);
  // origin: x centre of hubs, ground = lowest tyre point, z = axle midpoint
  const ox = (hubRaw.FL[0] + hubRaw.FR[0] + hubRaw.RL[0] + hubRaw.RR[0]) / 4;
  const oy = Math.min(...CORNERS.map((c) => hubRaw[c][4]));
  const oz = (hubRaw.FL[2] + hubRaw.FR[2] + hubRaw.RL[2] + hubRaw.RR[2]) / 4;
  const norm = { pos: (x, y, z) => [(x - ox) * scale, (y - oy) * scale, (z - oz) * scale], dir: (x, y, z) => [x, y, z] };
  xformParts(all, norm);

  // assign every wheel island to its corner by centroid
  const wheelAssign = { FL: [], FR: [], RL: [], RR: [] };
  const zs = CORNERS.map((c) => (hubRaw[c][2] - oz) * scale), xs = CORNERS.map((c) => (hubRaw[c][0] - ox) * scale);
  const hub = {};
  CORNERS.forEach((c, i) => { hub[c] = [xs[i], (hubRaw[c][1] - oy) * scale, zs[i]]; });
  for (const p of wIslands) {
    const ce = centre(p);
    wheelAssign[(ce[2] > 0 ? 'F' : 'R') + (ce[0] > 0 ? 'L' : 'R')].push(p);
  }
  const wheelR = CORNERS.reduce((a, c) => a + hubRaw[c][3] * scale, 0) / 4;

  // materials: paint / glass
  const mats = doc.getRoot().listMaterials();
  const paintMats = mats.filter((m) => cfg.paint.test(m.getName()));
  const glassMats = mats.filter((m) => cfg.glass.test(m.getName()));
  if (!paintMats.length) throw new Error(`${id}: no paint material matched`);
  const paintMain = paintMats[0], glassMain = glassMats[0];
  // paintable when the body colour is a plain factor, or its albedo texture is near-neutral (game can tint it)
  let paintable = true;
  const bt = paintMain.getBaseColorTexture();
  if (bt) {
    const st = await sharp(Buffer.from(bt.getImage())).resize(64, 64, { fit: 'fill' }).removeAlpha().stats();
    const m = st.channels.map((c) => c.mean);
    paintable = Math.max(...m) - Math.min(...m) < 18; // 0..255 scale
    log.push(`paint texture channel means ${m.map((v) => v.toFixed(0))} -> paintable ${paintable}`);
  }
  paintMain.setName('paint');
  if (glassMain) {
    glassMain.setName('glass').setBaseColorTexture(null).setBaseColorFactor([0.04, 0.06, 0.08, 0.32]).setAlphaMode('BLEND').setMetallicFactor(0).setRoughnessFactor(0.04).setDoubleSided(false);
    glassMain.setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
  }
  const matMap = (m) => (paintMats.includes(m) && cfg.mergePaint !== false ? paintMain : glassMats.includes(m) ? glassMain : m);

  // rebuild scene
  const scene = doc.getRoot().listScenes()[0];
  for (const n of scene.listChildren()) { scene.removeChild(n); }
  doc.getRoot().listNodes().forEach((n) => n.dispose());
  doc.getRoot().listMeshes().forEach((m) => m.dispose());
  const rootNode = doc.createNode('car');
  scene.addChild(rootNode);
  const bodyNode = doc.createNode('body').setMesh(mergeToMesh(doc, buffer, 'body_geo', bodyParts, matMap));
  rootNode.addChild(bodyNode);
  const bb = unionBounds([...bodyParts, ...wIslands]); // before wheels are re-centred on their hubs
  for (const c of CORNERS) {
    const ps = wheelAssign[c];
    const h = hub[c];
    xformParts(ps, { pos: (x, y, z) => [x - h[0], y - h[1], z - h[2]], dir: (x, y, z) => [x, y, z] });
    const wn = doc.createNode('wheel_' + c).setTranslation(h);
    wn.addChild(doc.createNode('wheel_' + c + '_geo_node').setMesh(mergeToMesh(doc, buffer, 'wheel_' + c + '_geo', ps, matMap)));
    rootNode.addChild(wn);
  }

  // weld + simplify (budget split: wheels keep detail, interior/low-priority parts reduced harder)
  const meshes = doc.getRoot().listMeshes();
  const bodyMesh = bodyNode.getMesh();
  for (const m of meshes) for (const p of m.listPrimitives()) weldPrimitive(p, { tolerance: 1e-5 });
  const wheelTris = meshes.filter((m) => m !== bodyMesh).reduce((a, m) => a + triOf(m), 0);
  const wheelBudget = Math.min(wheelTris, cfg.wheelTris ?? 6000);
  const bodyBudget = cfg.tris - wheelBudget;
  const bodyTris = triOf(bodyMesh);
  const simp = (mesh, ratio) => {
    for (const p of mesh.listPrimitives()) {
      const before = p.getIndices().getCount() / 3;
      if (before < 40) continue;
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio), error: cfg.error ?? 0.02, lockBorder: true });
      compactPrimitive(p);
    }
  };
  // two-pass so the total lands near budget even when error caps limit some prims
  let r = bodyBudget / bodyTris;
  simp(bodyMesh, r);
  let t = triOf(bodyMesh);
  if (t > bodyBudget * 1.08) { r = (bodyBudget / t) * 0.98; simp(bodyMesh, r); }
  for (const m of meshes) if (m !== bodyMesh) simp(m, wheelBudget / wheelTris);

  // cleanup, textures, compression
  await doc.transform(dedup(), prune({ keepLeaves: true, keepExtras: false }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texSize ?? 1024, cfg.texSize ?? 1024], quality: 80 }));
  await doc.transform(prune({ keepLeaves: true }), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const tris = doc.getRoot().listMeshes().reduce((a, m) => a + triOf(m), 0);
  // final bounds
  const info = {
    wheelbase: +((hub.FL[2] + hub.FR[2] - hub.RL[2] - hub.RR[2]) / 2).toFixed(3),
    track: +((hub.FL[0] - hub.FR[0] + hub.RL[0] - hub.RR[0]) / 2).toFixed(3),
    wheelR: +wheelR.toFixed(3),
    halfW: +Math.max(-bb.mn[0], bb.mx[0]).toFixed(3),
    halfL: +((bb.mx[2] - bb.mn[2]) / 2).toFixed(3),
    paintable, staticWheels: false, tris: Math.round(tris),
  };
  log.push(`bounds x[${bb.mn[0].toFixed(2)},${bb.mx[0].toFixed(2)}] y[${bb.mn[1].toFixed(2)},${bb.mx[1].toFixed(2)}] z[${bb.mn[2].toFixed(2)},${bb.mx[2].toFixed(2)}]`);
  log.push('hubs ' + CORNERS.map((c) => c + '(' + hub[c].map((v) => v.toFixed(2)).join(',') + ')').join(' '));
  return { doc, info, log };
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'licenses'), { recursive: true });
let gen = {};
try { gen = JSON.parse(fs.readFileSync(genPath, 'utf8')); } catch {}
for (const id of ids.length ? ids : Object.keys(CARS)) {
  const cfg = CARS[id];
  const dir = unzip(id);
  if (inspect) {
    console.log(`\n===== ${id} =====`);
    inspectDoc(await io.read(path.join(dir, 'scene.gltf')), { wheelRe: cfg.inspectRe });
    continue;
  }
  console.log(`\n===== ${id} =====`);
  const { doc, info, log } = await buildCar(id, cfg, dir);
  const out = path.join(outDir, id + '.glb');
  await io.write(out, doc);
  const size = fs.statSync(out).size;
  fs.copyFileSync(path.join(dir, 'license.txt'), path.join(outDir, 'licenses', id + '.txt'));
  gen[id] = info;
  log.forEach((l) => console.log('  ' + l));
  console.log('  ', JSON.stringify(info), `size ${(size / 1024).toFixed(0)} KB`, size > MAX_BYTES ? 'OVER 3MB' : '');
}
if (!inspect) {
  const sorted = Object.fromEntries(Object.keys(CARS).filter((k) => gen[k]).map((k) => [k, gen[k]]));
  fs.mkdirSync(path.dirname(genPath), { recursive: true });
  fs.writeFileSync(genPath, JSON.stringify(sorted, null, 2) + '\n');
}
