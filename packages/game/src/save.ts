import { MAX_LEVEL, PART_IDS, defaultTuning, isCarId, newCareer, newSetup, noParts, type Career, type CarSetup } from '../../sim/src/index';

export interface Settings { quality: string; auto: boolean; cam: 'chase' | 'far' | 'bumper' | 'hood' | 'cockpit'; radioOn: boolean; }
const KEY = 'rh_career', SKEY = 'rh_settings';
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
function cleanSetup(raw: any): CarSetup {
  const s = newSetup(), parts = noParts(), tune = defaultTuning();
  for (const id of PART_IDS) parts[id] = Math.max(0, Math.min(MAX_LEVEL, Math.round(num(raw?.parts?.[id], 0))));
  return { parts, tuning: { gearing: num(raw?.tuning?.gearing, tune.gearing), wing: num(raw?.tuning?.wing, tune.wing), bias: num(raw?.tuning?.bias, tune.bias) }, paint: num(raw?.paint, s.paint), finish: num(raw?.finish, s.finish), wheels: num(raw?.wheels, s.wheels) };
}
/** Turn a stored career (current, or the legacy single-car shape) into a valid current one. */
export function migrateCareer(raw: any): Career {
  const fresh = newCareer();
  if (!raw || raw.v !== 1) return fresh;
  const c: Career = { ...fresh, ...raw, cars: { ...fresh.cars } };
  // legacy saves kept parts / tuning / paint at the top level: they belong to the Aurora
  const legacy = raw.parts !== undefined || raw.tuning !== undefined || raw.paint !== undefined;
  const src: Record<string, unknown> = { ...(raw.cars && typeof raw.cars === 'object' ? raw.cars : {}) };
  if (legacy && !src.aurora) src.aurora = { parts: raw.parts, tuning: raw.tuning, paint: raw.paint, finish: raw.finish, wheels: raw.wheels };
  for (const id of Object.keys(fresh.cars) as (keyof Career['cars'])[]) c.cars[id] = cleanSetup(src[id]);
  for (const k of ['parts', 'tuning', 'paint', 'finish', 'wheels']) delete (c as any)[k];
  c.car = isCarId(raw.car) ? raw.car : fresh.car;
  c.money = num(raw.money, fresh.money); c.rep = num(raw.rep, 0);
  if (!c.results || typeof c.results !== 'object') c.results = {};
  if (!c.ghost || typeof c.ghost !== 'object') c.ghost = {};
  return c;
}
export function loadCareer(): Career { try { return migrateCareer(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { /* fresh start */ } return newCareer(); }
export function saveCareer(c: Career) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full: drop ghosts and retry */ c.ghost = {}; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* give up */ } } }
export function loadSettings(): Settings { let s: Partial<Settings> = {}; try { s = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { /* defaults */ } return { quality: 'high', auto: true, cam: 'chase', radioOn: true, ...s }; }
export const saveSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s));
