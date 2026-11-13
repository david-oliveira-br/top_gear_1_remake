import { newCareer, type Career } from '../../sim/src/index';

export interface Settings { quality: string; auto: boolean; cam: 'chase' | 'far' | 'bumper' | 'hood' | 'cockpit'; radioOn: boolean; }
const KEY = 'rh_career', SKEY = 'rh_settings';
export function loadCareer(): Career { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.v === 1) return { ...newCareer(), ...c }; } catch { /* fresh start */ } return newCareer(); }
export function saveCareer(c: Career) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full: drop ghosts and retry */ c.ghost = {}; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* give up */ } } }
export function loadSettings(): Settings { let s: Partial<Settings> = {}; try { s = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { /* defaults */ } return { quality: 'high', auto: true, cam: 'chase', radioOn: true, ...s }; }
export const saveSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s));
