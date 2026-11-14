// Per-car build config consumed by tools/build-cars.mjs.
//  front          native forward axis of the source model ('+z' | '-z' | '+x' | '-x')
//  realWheelbase  metres; whole model is scaled so measured hub spacing matches
//  drop           regex on any node name along the path: subtree removed (duplicate LODs, damage meshes)
//  wheel(part)    true for geometry that belongs to a wheel (tyre, rim, disc); split into 4 corners by position
//  tyre(part)     the tyre subset of wheel geometry, used to find hub centre + radius
//  paint / glass  regex on source material names -> renamed 'paint' / 'glass' (same-name sources merged)
//  tris           total triangle budget; wheelTris: portion kept for the 4 wheels
const p = (x) => x.path;
export const CARS = {
  corvette: {
    zip: '1962_chevrolet_corvette_grand_sport.zip', front: '-z', realWheelbase: 2.49,
    drop: /DAMAGE|BROKEN/,
    wheel: (x) => /(^|\/)wheel_[FB][LR]/i.test(p(x)) && !/CALIPER/.test(p(x)),
    tyre: (x) => /TYRE/.test(p(x)),
    paint: /_ext$/, glass: /_windows$/, tris: 40000,
    inspectRe: /wheel_[FB][LR]/i,
  },
  cuda: {
    zip: '1970_plymouth_barracuda_gen_iii.zip', front: '-z', realWheelbase: 2.74,
    wheel: (x) => /(^|\/)wheel[FB][LR]/.test(p(x)),
    tyre: (x) => /tyre/.test(p(x)),
    paint: /^exterior/, glass: /^glass\./, tris: 30000,
  },
  mustang: {
    zip: 'ford_mustang_gt_fastback.zip', front: '-z', realWheelbase: 2.74,
    wheel: (x) => /(^|\/)wheel[FB][LR]/.test(p(x)),
    tyre: (x) => /tyre/.test(p(x)),
    paint: /^exterior$/, glass: /^glass$/, tris: 30000,
  },
  golf: {
    zip: '1976_volkswagen_golf_gti.zip', front: '+z', realWheelbase: 2.40,
    wheel: (x) => /^(tire|disk|breaks)$|^vM_Rim_/.test(x.matName),
    tyre: (x) => x.matName === 'tire',
    paint: /^vM_CarPaint_Max1$/, glass: /^vM_Glass_WindowFront_Low1$/, tris: 40000,
  },
  m635: {
    zip: '1986_bmw_m635csi.zip', front: '+z', realWheelbase: 2.63,
    wheel: (x) => /wheel_rim|rotor/.test(p(x)),
    tyre: (x) => x.matName === 'tire',
    paint: /^body$/, glass: /^window$/, tris: 60000,
  },
  alfa155: {
    zip: '1992_alfa_romeo_155_q4.zip', front: '+z', realWheelbase: 2.54,
    wheel: (x) => /tirea_s|rotor/.test(p(x)),
    tyre: (x) => /^(sidewall|tread)$/.test(x.matName),
    paint: /^body(_2)?$/, glass: /^window$/, tris: 60000, wheelTris: 12000, error: 0.05,
  },
};
