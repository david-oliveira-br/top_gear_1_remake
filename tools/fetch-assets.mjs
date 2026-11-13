// Download the CC0 assets the game uses from Poly Haven into packages/game/public/assets and record credits.
// usage: node tools/fetch-assets.mjs
import fs from 'node:fs';
const OUT = new URL('../packages/game/public/assets/', import.meta.url).pathname;
const UA = { 'User-Agent': 'asset-fetch/1.0' };
const HDRIS = [['kloppenheim_06_puresky', '4k']];
// id, resolution, maps
const TEXTURES = [
  ['asphalt_04', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['aerial_grass_rock', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['aerial_beach_01', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['rock_face_03', '2k', ['Diffuse', 'nor_gl', 'Rough']],
  ['concrete_wall_008', '1k', ['Diffuse', 'nor_gl', 'Rough']],
];
const api = async (p) => (await fetch('https://api.polyhaven.com/' + p, { headers: UA })).json();
async function get(url, file) {
  if (fs.existsSync(file)) return fs.statSync(file).size;
  const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(r.status + ' ' + url);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return fs.statSync(file).size;
}
fs.mkdirSync(OUT, { recursive: true });
const credits = ['# Asset credits', '', 'All files in this folder come from [Poly Haven](https://polyhaven.com) and are licensed CC0 (public domain).', '', '| File | Asset | Author |', '|---|---|---|'];
for (const [id, res] of HDRIS) {
  const f = await api('files/' + id), info = await api('info/' + id), u = f.hdri?.[res]?.hdr;
  if (!u) { console.log('missing', id); continue; }
  console.log(id, await get(u.url, `${OUT}${id}_${res}.hdr`));
  credits.push(`| ${id}_${res}.hdr | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} |`);
}
for (const [id, res, maps] of TEXTURES) {
  const f = await api('files/' + id), info = await api('info/' + id);
  if (f.error || !info.name) { console.log('missing', id, Object.keys(f).slice(0, 12).join(',')); continue; }
  for (const m of maps) {
    const u = f[m]?.[res]?.jpg; if (!u) { console.log('missing map', id, m, Object.keys(f).join(',')); continue; }
    console.log(id, m, await get(u.url, `${OUT}${id}_${m.toLowerCase()}.jpg`));
  }
  credits.push(`| ${id}_*.jpg | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} |`);
}
// Cars (Grab3D, CC0 1.0)
fs.mkdirSync(OUT + 'cars/', { recursive: true });
const CARS = ['1990s-sports-car', '1980s-sports-car'];
const carCredits = ['', '## Car models', '', 'Licensed CC0 1.0 (public domain), from [Grab3D](https://grab3d.com).', '', '| File | Asset | Source |', '|---|---|---|'];
for (const id of CARS) {
  console.log(id, await get(`https://grab3d.com/dl/${id}/${id}.glb`, `${OUT}cars/${id}.glb`));
  carCredits.push(`| cars/${id}.glb | ${id.replace(/-/g, ' ')} | https://grab3d.com/models/vehicles/${id}/ |`);
}
// Car Concept (Khronos glTF-Sample-Assets, CC BY 4.0): the player's car. Attribution is required; the game replaces the Khronos / 3D Commerce logos at load time (see packages/game/src/car/glb.ts).
console.log('CarConcept', await get('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb', `${OUT}cars/CarConcept.glb`));
carCredits.push('| cars/CarConcept.glb | **Car Concept** by Eric Chadwick (Darmstadt Graphics Group GmbH) for Khronos, 2024, from a public-domain model by Unity Fan; CC BY 4.0 (see below) | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept |');
// First-person interior, drawn only for the player's car in the cockpit view
console.log('sports-car-cockpit', await get('https://grab3d.com/dl/sports-car-cockpit/sports-car-cockpit-light.glb', `${OUT}cars/sports-car-cockpit-light.glb`));
carCredits.push('| cars/sports-car-cockpit-light.glb | sports car cockpit (interior, cockpit view only) | https://grab3d.com/models/vehicles/sports-car-cockpit/ |');
carCredits.push('', '### Car Concept attribution (CC BY 4.0)', '', '"Car Concept" by Eric Chadwick, Darmstadt Graphics Group GmbH (2024), distributed by the Khronos Group in glTF-Sample-Assets: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept . Started from the public-domain model "Free Concept Car 004" by Unity Fan, then optimised by Khronos. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes made for this game: the Khronos Group and 3D Commerce logos and the licence-plate texture are removed and replaced (blank plain-rubber sidewalls, a made-up plate), interior and under-body parts are hidden when not needed, paint, rims and lamps are recoloured at run time, and wheels are re-rigged to spin and steer. The licence excludes logos and trademarks; none are shown by this game.');
fs.writeFileSync(OUT + 'CREDITS.md', credits.concat(carCredits).join('\n') + '\n');
