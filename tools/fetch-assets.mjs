// Download the CC0 assets the game uses from Poly Haven into packages/game/public/assets and record credits.
// usage: node tools/fetch-assets.mjs [--cars]
// Only the Poly Haven rows of CREDITS.md are rewritten (the car, Sketchfab and radio sections are kept). --cars also downloads the Grab3D / Khronos car models (their credits live in CREDITS.md already).
import fs from 'node:fs';
const OUT = new URL('../packages/game/public/assets/', import.meta.url).pathname;
const UA = { 'User-Agent': 'asset-fetch/1.0' };
const HDRIS = [['kloppenheim_06_puresky', '4k'], ['kloofendal_43d_clear_puresky', '2k'], ['kloofendal_48d_partly_cloudy_puresky', '2k']];
// id, resolution, maps
const TEXTURES = [
  ['asphalt_04', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['aerial_grass_rock', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['aerial_beach_01', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['rock_face_03', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['concrete_wall_008', '1k', ['Diffuse', 'nor_gl', 'Rough']],
  // Rockies / Patagonia
  ['snow_02', '1k', ['Diffuse', 'nor_gl', 'Rough']],
  ['forrest_ground_01', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['aerial_rocks_02', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['dry_ground_rocks', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['gravel_ground_01', '1k', ['Diffuse', 'nor_gl', 'Rough']],
  ['coast_sand_rocks_02', '2k', ['Diffuse', 'nor_gl', 'Rough']],
];
const api = async (p) => (await fetch('https://api.polyhaven.com/' + p, { headers: UA })).json();
async function get(url, file) {
  if (fs.existsSync(file)) return fs.statSync(file).size;
  const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return fs.statSync(file).size;
}
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [id, res] of HDRIS) {
  const f = await api('files/' + id), info = await api('info/' + id), u = f.hdri?.[res]?.hdr;
  if (!u) { console.log('missing', id); continue; }
  console.log(id, await get(u.url, `${OUT}${id}_${res}.hdr`));
  rows.push(`| ${id}_${res}.hdr | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} |`);
}
for (const [id, res, maps] of TEXTURES) {
  const f = await api('files/' + id), info = await api('info/' + id);
  if (f.error || !info.name) { console.log('missing', id, Object.keys(f).slice(0, 12).join(',')); continue; }
  for (const m of maps) {
    const u = f[m]?.[res]?.jpg; if (!u) { console.log('missing map', id, m, Object.keys(f).join(',')); continue; }
    console.log(id, m, await get(u.url, `${OUT}${id}_${m.toLowerCase()}.jpg`));
  }
  rows.push(`| ${id}_*.jpg | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} |`);
}
// Cars (Grab3D, CC0 1.0; Khronos Car Concept, CC BY 4.0) - only with --cars
if (process.argv.includes('--cars')) {
fs.mkdirSync(OUT + 'cars/', { recursive: true });
const CARS = ['1990s-sports-car', '1980s-sports-car'];
for (const id of CARS) {
  console.log(id, await get(`https://grab3d.com/dl/${id}/${id}.glb`, `${OUT}cars/${id}.glb`));
}
// Car Concept (Khronos glTF-Sample-Assets, CC BY 4.0): the player's car. Attribution is required; the game replaces the Khronos / 3D Commerce logos at load time (see packages/game/src/car/glb.ts).
console.log('CarConcept', await get('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb', `${OUT}cars/CarConcept.glb`));
// First-person interior, drawn only for the player's car in the cockpit view
console.log('sports-car-cockpit', await get('https://grab3d.com/dl/sports-car-cockpit/sports-car-cockpit-light.glb', `${OUT}cars/sports-car-cockpit-light.glb`));
}
// Splice only the Poly Haven rows into CREDITS.md: rows linking polyhaven.com are replaced, everything else (cars, Sketchfab, radio) is kept.
const CF = OUT + 'CREDITS.md';
const hdr = ['# Asset credits', '', 'All files in this folder come from [Poly Haven](https://polyhaven.com) and are licensed CC0 (public domain).', '', '| File | Asset | Author |', '|---|---|---|'];
let lines = fs.existsSync(CF) ? fs.readFileSync(CF, 'utf8').split('\n') : hdr.concat('');
const sep = lines.findIndex((l, i) => l.startsWith('|---') && /^\| File \| Asset \| Author/.test(lines[i - 1] ?? ''));
if (sep < 0) { lines = hdr.concat(rows, [''], lines); }
else { let end = sep + 1; while (end < lines.length && lines[end].startsWith('|')) end++; lines.splice(sep + 1, end - sep - 1, ...rows); }
fs.writeFileSync(CF, lines.join('\n'));
