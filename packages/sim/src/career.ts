import type { Driver } from './ai';
import { DEFAULT_CAR, carById, type CarId } from './cars';
import { MAX_LEVEL, PART_PRICE, buildSpec, defaultTuning, noParts, type PartId, type Parts, type Tuning } from './specs';

export interface City { id: string; name: string; country: string; lat: number; lon: number; landmark: string; /** reputation needed to travel there */ rep: number; ready: boolean;
  /** event id that must have been won (place 1) before the city opens */ needs?: string; }

export const CITIES: City[] = [
  { id: 'rio', name: 'Rio de Janeiro', country: 'Brasil', lat: -22.95, lon: -43.21, landmark: 'Cristo Redentor', rep: 0, ready: true },
  { id: 'bigsur', name: 'Big Sur', country: 'EUA', lat: 36.27, lon: -121.81, landmark: 'Ponte em arco e farol', rep: 30, ready: true },
  { id: 'banff', name: 'Banff', country: 'Canadá', lat: 51.18, lon: -115.57, landmark: 'Lago glacial e picos nevados', rep: 90, ready: true },
  { id: 'patagonia', name: 'Torres del Paine', country: 'Chile', lat: -50.94, lon: -73.41, landmark: 'Torres de granito', rep: 170, ready: true, needs: 'rio-rival' },
  { id: 'london', name: 'Londres', country: 'Reino Unido', lat: 51.5, lon: -0.12, landmark: 'Torre do relógio', rep: 220, ready: false, needs: 'rio-rival' },
  { id: 'rome', name: 'Roma', country: 'Itália', lat: 41.89, lon: 12.49, landmark: 'Coliseu', rep: 320, ready: false, needs: 'rio-rival' },
  { id: 'bergen', name: 'Bergen', country: 'Noruega', lat: 60.39, lon: 5.32, landmark: 'Fiordes', rep: 420, ready: false, needs: 'rio-rival' },
  { id: 'cairo', name: 'Cairo', country: 'Egito', lat: 30.04, lon: 31.24, landmark: 'Pirâmides', rep: 520, ready: false, needs: 'rio-rival' },
  { id: 'tokyo', name: 'Tóquio', country: 'Japão', lat: 35.68, lon: 139.69, landmark: 'Torre treliçada', rep: 640, ready: false, needs: 'rio-rival' },
  { id: 'sydney', name: 'Sydney', country: 'Austrália', lat: -33.86, lon: 151.21, landmark: 'Ópera e ponte', rep: 760, ready: false, needs: 'rio-rival' },
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
    rivals: [], prize: [5000, 3000, 1500, 400], fame: [25, 15, 8, 1], medals: [81.5, 86, 92] },
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
  { id: 'rockies-run', city: 'banff', track: 'rockies', kind: 'grid', name: 'Corrida da Parkway', blurb: 'Do lago aos grampos e à passagem nevada. Largada na margem, chegada no alojamento.', laps: 1, rep: 90,
    rivals: [...field(1, [1, 5, 3], D('Maeve', 0.925, 0.6, 0.85), D('Logan', 0.91, 0.5, 0.8), D('Tessa', 0.895, 0.7, 0.7)), ...field(0, [8, 6, 2, 7], D('Gus', 0.88, 0.4, 0.8), D('Piper', 0.865, 0.8, 0.6), D('Dale', 0.85, 0.5, 0.7), D('Hazel', 0.83, 0.6, 0.5))],
    prize: [12000, 8400, 6000, 4000, 2700, 1800, 1100, 700], fame: [50, 34, 23, 15, 10, 6, 3, 1] },
  { id: 'rockies-trial', city: 'banff', track: 'rockies', kind: 'trial', name: 'Sprint da Passagem', blurb: 'Estrada livre até o alojamento. Só você, a neve e o cronômetro.', laps: 1, rep: 90,
    rivals: [], prize: [8000, 4800, 2400, 600], fame: [35, 21, 11, 1], medals: [159.3, 167.1, 177.8] },
  { id: 'rockies-duel', city: 'banff', track: 'rockies', kind: 'duel', name: 'Duelo nos Grampos', blurb: 'Um contra um com Maeve, a guarda-parque que conhece cada curva.', laps: 1, rep: 130,
    rivals: field(2, [4], D('Maeve', 0.945, 0.7, 0.92)), prize: [11000, 2000], fame: [45, 6] },
  { id: 'pata-run', city: 'patagonia', track: 'patagonia', kind: 'grid', name: 'Corrida do Fim do Mundo', blurb: 'Estepe, lago glacial, bosque de lengas e morena. Chegada diante das torres.', laps: 1, rep: 170,
    rivals: [...field(2, [1, 5, 3], D('Mateo', 0.945, 0.6, 0.85), D('Valentina', 0.93, 0.5, 0.9), D('Joaquín', 0.915, 0.8, 0.7)), ...field(1, [8, 6, 2, 7], D('Camila', 0.9, 0.4, 0.8), D('Ignacio', 0.885, 0.7, 0.6), D('Sofía', 0.87, 0.5, 0.7), D('Tomás', 0.85, 0.6, 0.6))],
    prize: [16000, 11200, 8000, 5400, 3600, 2400, 1500, 900], fame: [65, 44, 30, 20, 13, 8, 4, 2] },
  { id: 'pata-trial', city: 'patagonia', track: 'patagonia', kind: 'trial', name: 'Contra o Vento', blurb: 'Estrada livre rumo às torres. Só você, o vento e o cronômetro.', laps: 1, rep: 170,
    rivals: [], prize: [10000, 6000, 3000, 800], fame: [40, 24, 12, 1], medals: [163.7, 171.8, 182.7] },
  { id: 'pata-rival', city: 'patagonia', track: 'patagonia', kind: 'rival', name: 'El Cóndor', blurb: 'O dono da Ruta del Fin del Mundo não divide a estrada com ninguém.', laps: 1, rep: 240,
    rivals: field(3, [12], D('El Cóndor', 0.97, 0.9, 0.97)), prize: [30000, 3500], fame: [140, 12] },
];

/** Everything the player owns and has set up for one car. */
export interface CarSetup { parts: Parts; tuning: Tuning; paint: number; finish: number; wheels: number; }
export const newSetup = (): CarSetup => ({ parts: noParts(), tuning: defaultTuning(), paint: 0, finish: 0, wheels: 0 });

export interface Career {
  v: 1; money: number; rep: number;
  /** the car being driven, and the parts / tuning / paint kept separately for every car */
  car: CarId; cars: Record<CarId, CarSetup>;
  /** best finishing place per event (trial: medal rank 1..4) and best lap in ticks */
  results: Record<string, { place: number; best: number }>;
  ghost: Record<string, number[]>;
}

export const newCareer = (): Career => ({
  v: 1, money: 2500, rep: 0, car: DEFAULT_CAR,
  cars: { aurora: newSetup(), corvette: newSetup(), cuda: newSetup(), mustang: newSetup(), golf: newSetup(), m635: newSetup(), alfa155: newSetup() },
  results: {}, ghost: {},
});

/** Setup (parts, tuning, paint) of the car currently selected. */
export const setupOf = (c: Career): CarSetup => c.cars[c.car] ?? (c.cars[c.car] = newSetup());
/** Physics spec of the selected car with its parts and tuning applied. */
export const playerSpec = (c: Career) => buildSpec(setupOf(c).parts, setupOf(c).tuning, carById(c.car).spec);

export const priceOf = (c: Career, p: PartId) => { const l = setupOf(c).parts[p]; return l >= MAX_LEVEL ? 0 : PART_PRICE[p][l]; };
export const canBuy = (c: Career, p: PartId) => setupOf(c).parts[p] < MAX_LEVEL && c.money >= priceOf(c, p);
export function buyPart(c: Career, p: PartId): boolean {
  if (!canBuy(c, p)) return false;
  c.money -= priceOf(c, p); setupOf(c).parts[p]++; return true;
}

/** Cars for the rivals of an event, in the same order as `ev.rivals`: the faster the driver, the faster the car. */
const PACE_ORDER: CarId[] = ['corvette', 'm635', 'aurora', 'alfa155', 'mustang', 'cuda', 'golf'];
export function rivalCars(ev: RaceEvent): CarId[] {
  return ev.rivals.map((r) => PACE_ORDER[Math.round((1 - Math.max(0, Math.min(1, (r.driver.skill - 0.8) / 0.17))) * (PACE_ORDER.length - 1))]);
}
/** Physics spec of a rival: the event's part level on the rival's own car, with default tuning. */
export function rivalSpec(level: number, car: CarId) {
  const p = noParts(); for (const k of Object.keys(p) as PartId[]) p[k] = level;
  return buildSpec(p, defaultTuning(), carById(car).spec);
}

export const eventOpen = (c: Career, e: RaceEvent) => c.rep >= e.rep;
export const cityOpen = (c: Career, city: City) => city.ready && c.rep >= city.rep && (!city.needs || c.results[city.needs]?.place === 1);
/** A city is finished once its rival event is won, or (without one) every event of the city has been won. */
export function cityDone(c: Career, city: City) {
  const evs = EVENTS.filter((e) => e.city === city.id), rival = evs.find((e) => e.kind === 'rival');
  return rival ? c.results[rival.id]?.place === 1 : evs.length > 0 && evs.every((e) => c.results[e.id]?.place === 1);
}

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
