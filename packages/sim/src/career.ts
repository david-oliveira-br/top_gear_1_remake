import type { Driver } from './ai';
import { MAX_LEVEL, PART_PRICE, defaultTuning, noParts, type PartId, type Parts, type Tuning } from './specs';

export interface City { id: string; name: string; country: string; lat: number; lon: number; landmark: string; /** reputation needed to travel there */ rep: number; ready: boolean; }

export const CITIES: City[] = [
  { id: 'rio', name: 'Rio de Janeiro', country: 'Brasil', lat: -22.95, lon: -43.21, landmark: 'Cristo Redentor', rep: 0, ready: true },
  { id: 'bigsur', name: 'Big Sur', country: 'EUA', lat: 36.27, lon: -121.81, landmark: 'Ponte em arco e farol', rep: 30, ready: true },
  { id: 'london', name: 'Londres', country: 'Reino Unido', lat: 51.5, lon: -0.12, landmark: 'Torre do relógio', rep: 220, ready: false },
  { id: 'rome', name: 'Roma', country: 'Itália', lat: 41.89, lon: 12.49, landmark: 'Coliseu', rep: 320, ready: false },
  { id: 'bergen', name: 'Bergen', country: 'Noruega', lat: 60.39, lon: 5.32, landmark: 'Fiordes', rep: 420, ready: false },
  { id: 'cairo', name: 'Cairo', country: 'Egito', lat: 30.04, lon: 31.24, landmark: 'Pirâmides', rep: 520, ready: false },
  { id: 'tokyo', name: 'Tóquio', country: 'Japão', lat: 35.68, lon: 139.69, landmark: 'Torre treliçada', rep: 640, ready: false },
  { id: 'sydney', name: 'Sydney', country: 'Austrália', lat: -33.86, lon: 151.21, landmark: 'Ópera e ponte', rep: 760, ready: false },
];

export type EventKind = 'grid' | 'duel' | 'trial' | 'rival';
export interface RaceEvent {
  id: string; city: string; track: string; kind: EventKind; name: string; blurb: string; laps: number;
  /** reputation needed to enter */
  rep: number; rivals: { driver: Driver; parts: number; paint: number }[];
  /** prize money and reputation by finishing place (1st first) */
  prize: number[]; fame: number[];
  /** time trial: best-lap targets in seconds for gold, silver, bronze */
  medals?: [number, number, number];
}

const D = (name: string, skill: number, aggression: number, consistency: number): Driver => ({ name, skill, aggression, consistency });
const field = (level: number, paints: number[], ...d: Driver[]) => d.map((driver, i) => ({ driver, parts: level, paint: paints[i % paints.length] }));

export const EVENTS: RaceEvent[] = [
  { id: 'rio-sprint', city: 'rio', track: 'rio', kind: 'grid', name: 'Sprint da Orla', blurb: 'Três voltas à beira-mar contra a turma local.', laps: 3, rep: 0,
    rivals: field(0, [1, 2, 3, 4, 5, 6, 7], D('Tainá', 0.9, 0.5, 0.8), D('Beto', 0.885, 0.8, 0.6), D('Íris', 0.87, 0.3, 0.9), D('Caio', 0.855, 0.6, 0.6), D('Malu', 0.84, 0.4, 0.7), D('Duda', 0.825, 0.7, 0.5), D('Nando', 0.8, 0.5, 0.5)),
    prize: [6000, 4200, 3000, 2000, 1400, 900, 600, 400], fame: [30, 20, 14, 9, 6, 4, 2, 1] },
  { id: 'rio-trial', city: 'rio', track: 'rio', kind: 'trial', name: 'Contra o Relógio', blurb: 'Pista livre. Só você, o carro e o cronômetro.', laps: 3, rep: 0,
    rivals: [], prize: [5000, 3000, 1500, 400], fame: [25, 15, 8, 1], medals: [80, 85, 92] },
  { id: 'rio-duel', city: 'rio', track: 'rio', kind: 'duel', name: 'Duelo no Mirante', blurb: 'Um contra um com a piloto mais rápida do bairro.', laps: 2, rep: 25,
    rivals: field(1, [8], D('Tainá', 0.93, 0.7, 0.9)), prize: [7000, 1500], fame: [35, 5] },
  { id: 'rio-gp', city: 'rio', track: 'rio', kind: 'grid', name: 'Grande Prêmio do Rio', blurb: 'Cinco voltas, grid completo e carros preparados.', laps: 5, rep: 60,
    rivals: field(1, [2, 9, 4, 10, 6, 11, 3], D('Tainá', 0.94, 0.6, 0.9), D('Beto', 0.925, 0.9, 0.7), D('Íris', 0.91, 0.4, 0.95), D('Caio', 0.9, 0.6, 0.7), D('Malu', 0.885, 0.5, 0.8), D('Duda', 0.87, 0.8, 0.6), D('Nando', 0.85, 0.5, 0.6)),
    prize: [14000, 9000, 6500, 4500, 3000, 2000, 1200, 800], fame: [60, 40, 28, 18, 12, 8, 4, 2] },
  { id: 'rio-rival', city: 'rio', track: 'rio', kind: 'rival', name: 'O Rei da Orla', blurb: 'Vença o dono da cidade para abrir as portas do mundo.', laps: 3, rep: 110,
    rivals: field(2, [12], D('Rei da Orla', 0.97, 0.9, 0.97)), prize: [25000, 3000], fame: [120, 10] },
  { id: 'coast-run', city: 'bigsur', track: 'coast', kind: 'grid', name: 'Corrida da Costa', blurb: 'Seis quilômetros de falésia, ponte e grampos. Largada na estrada, chegada no farol.', laps: 1, rep: 30,
    rivals: [...field(1, [1, 5, 3], D('Wyatt', 0.91, 0.6, 0.8), D('Marina', 0.895, 0.5, 0.85), D('Cole', 0.88, 0.8, 0.6)), ...field(0, [8, 6, 2, 7], D('Sierra', 0.865, 0.4, 0.8), D('Hank', 0.85, 0.7, 0.6), D('Josie', 0.835, 0.5, 0.7), D('Rusty', 0.815, 0.6, 0.5))],
    prize: [9000, 6200, 4400, 3000, 2000, 1300, 850, 550], fame: [40, 27, 18, 12, 8, 5, 3, 1] },
  { id: 'coast-trial', city: 'bigsur', track: 'coast', kind: 'trial', name: 'Sprint do Farol', blurb: 'Estrada livre até o farol. Só você, o oceano e o cronômetro.', laps: 1, rep: 30,
    rivals: [], prize: [6500, 3800, 1900, 500], fame: [30, 18, 9, 1], medals: [162, 170, 181] },
];

export interface Career {
  v: 1; money: number; rep: number; parts: Parts; tuning: Tuning; paint: number; finish: number; wheels: number;
  /** best finishing place per event (trial: medal rank 1..4) and best lap in ticks */
  results: Record<string, { place: number; best: number }>;
  ghost: Record<string, number[]>;
}

export const newCareer = (): Career => ({ v: 1, money: 2500, rep: 0, parts: noParts(), tuning: defaultTuning(), paint: 0, finish: 0, wheels: 0, results: {}, ghost: {} });

export const priceOf = (c: Career, p: PartId) => (c.parts[p] >= MAX_LEVEL ? 0 : PART_PRICE[p][c.parts[p]]);
export const canBuy = (c: Career, p: PartId) => c.parts[p] < MAX_LEVEL && c.money >= priceOf(c, p);
export function buyPart(c: Career, p: PartId): boolean {
  if (!canBuy(c, p)) return false;
  c.money -= priceOf(c, p); c.parts[p]++; return true;
}

export const eventOpen = (c: Career, e: RaceEvent) => c.rep >= e.rep;
export const cityOpen = (c: Career, city: City) => city.ready && c.rep >= city.rep && (city.id === 'rio' || city.id === 'bigsur' || c.results['rio-rival']?.place === 1);

/** Trial result: 1 gold, 2 silver, 3 bronze, 4 none. */
export function medal(e: RaceEvent, bestTicks: number) {
  if (!e.medals || !bestTicks) return 4;
  const s = bestTicks / 60; return s <= e.medals[0] ? 1 : s <= e.medals[1] ? 2 : s <= e.medals[2] ? 3 : 4;
}

/** Bank the result of an event. Repeat runs pay a third unless they improve on the best place. */
export function settle(c: Career, e: RaceEvent, place: number, bestTicks: number) {
  const prev = c.results[e.id], improved = !prev || place < prev.place, k = improved ? 1 : 0.34;
  const money = Math.round(((e.prize[place - 1] ?? 0) * k) / 50) * 50, rep = Math.round((e.fame[place - 1] ?? 0) * k);
  c.money += money; c.rep += rep;
  c.results[e.id] = { place: prev ? Math.min(prev.place, place) : place, best: prev?.best && bestTicks ? Math.min(prev.best, bestTicks) : bestTicks || prev?.best || 0 };
  return { money, rep, improved };
}
