import { CAR_CLASSES, CAR_COLORS, COUNTDOWN_TICKS, KMH, standings, type World } from '../../../shared/src/index';
import type { View } from './renderer';

const fmt = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
export const fmtTime = fmt;
const ORD = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');

export class Hud {
  private g: CanvasRenderingContext2D;
  constructor(private cv: HTMLCanvasElement) { this.g = cv.getContext('2d')!; }

  clear() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(this.cv.clientWidth * dpr), H = Math.round(this.cv.clientHeight * dpr);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    this.g.clearRect(0, 0, W, H);
  }

  draw(world: World, views: View[], time: number, extra: { ping?: number; names: boolean }) {
    this.clear();
    const order = standings(world);
    for (const v of views) this.view(world, v, order, time, extra);
  }

  private view(w: World, v: View, order: number[], time: number, extra: { ping?: number; names: boolean }) {
    const g = this.g, W = this.cv.width, H = this.cv.height;
    const x0 = v.rect[0] * W, y0 = v.rect[1] * H, vw = v.rect[2] * W, vh = v.rect[3] * H;
    const s = Math.min(vw / 1280, vh / 560);
    const c = w.cars[v.car]; if (!c) return;
    const cls = CAR_CLASSES[c.classId];
    const pos = order.indexOf(c.idx) + 1;
    const font = (px: number, wt = 800) => `italic ${wt} ${Math.round(px * s)}px "Segoe UI", system-ui, sans-serif`;
    const text = (t: string, x: number, y: number, px: number, col = '#fff', align: CanvasTextAlign = 'left', wt = 800) => {
      g.font = font(px, wt); g.textAlign = align; g.lineWidth = Math.max(2, px * s * 0.14); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineJoin = 'round';
      g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y);
    };
    g.save(); g.beginPath(); g.rect(x0, y0, vw, vh); g.clip();
    const m = 24 * s;

    // position + lap
    text(String(pos), x0 + m, y0 + m + 62 * s, 78, pos === 1 ? '#ffd23c' : '#fff');
    text('/' + w.cars.length, x0 + m + (pos > 9 ? 92 : 50) * s, y0 + m + 62 * s, 30, '#cfd6e4');
    const lap = Math.max(1, Math.min(w.laps, c.lap));
    text(`LAP ${lap}/${w.laps}`, x0 + vw - m, y0 + m + 34 * s, 36, '#fff', 'right');
    const t = Math.max(0, ((c.finished && c.finishTick ? c.finishTick : w.tick) - COUNTDOWN_TICKS) / 60);
    text(fmt(t), x0 + vw - m, y0 + m + 68 * s, 26, '#cfd6e4', 'right', 600);
    if (extra.ping !== undefined) text(`${extra.ping} ms`, x0 + vw - m, y0 + m + 94 * s, 16, extra.ping > 150 ? '#ff8a6a' : '#9fe6a8', 'right', 600);

    // progress strip
    const bx = x0 + vw * 0.3, bw = vw * 0.4, by = y0 + m + 10 * s;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect(bx - 8 * s, by - 7 * s, bw + 16 * s, 14 * s, 7 * s); g.fill();
    g.fillStyle = 'rgba(255,220,60,.5)'; g.fillRect(bx + bw * (w.track.pitStart / w.track.segments.length), by - 3 * s, bw * ((w.track.pitEnd - w.track.pitStart) / w.track.segments.length), 6 * s);
    for (const o of [...w.cars].sort((a) => (a === c ? 1 : -1))) {
      const px = bx + bw * (o.rz / w.track.length);
      g.fillStyle = CAR_COLORS[o.color]; g.strokeStyle = o === c ? '#fff' : 'rgba(0,0,0,.7)'; g.lineWidth = (o === c ? 3 : 1.5) * s;
      g.beginPath(); g.arc(px, by, (o === c ? 7 : 4.5) * s, 0, 7); g.fill(); g.stroke();
    }

    // speedo
    const cx = x0 + vw - m - 100 * s, cy = y0 + vh - m - 78 * s, r = 88 * s;
    g.fillStyle = 'rgba(8,10,16,.55)'; g.beginPath(); g.arc(cx, cy, r + 10 * s, 0, 7); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, rpm = Math.max(0, Math.min(1.05, c.rpm));
    g.lineCap = 'round'; g.lineWidth = 10 * s;
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    g.strokeStyle = 'rgba(255,60,60,.5)'; g.beginPath(); g.arc(cx, cy, r, a0 + (a1 - a0) * 0.88, a1); g.stroke();
    g.strokeStyle = c.nitroT > 0 ? '#59c8ff' : rpm > 0.9 ? '#ff4d4d' : '#ffd23c';
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.min(1, rpm)); g.stroke();
    text(String(Math.round(c.speed * KMH)), cx, cy + 14 * s, 54, '#fff', 'center');
    text('km/h', cx, cy + 38 * s, 16, '#cfd6e4', 'center', 600);
    text(String(c.gear), cx, cy + 82 * s, 34, rpm > 0.9 && !c.auto ? '#ff4d4d' : '#fff', 'center');
    text(c.auto ? 'AUTO' : 'MANUAL', cx, cy - 44 * s, 13, '#9aa6bd', 'center', 700);

    // fuel + nitro
    const fx = x0 + m, fy = y0 + vh - m - 26 * s, fw = 220 * s, fh = 18 * s;
    const low = c.fuel < 0.2, blink = low && Math.floor(time * 4) % 2 === 0;
    text('FUEL', fx, fy - 8 * s, 16, blink ? '#ff4d4d' : '#cfd6e4', 'left', 700);
    g.fillStyle = 'rgba(8,10,16,.6)'; g.beginPath(); g.roundRect(fx, fy, fw, fh, 5 * s); g.fill();
    g.fillStyle = low ? '#ff4d4d' : c.fuel < 0.4 ? '#ffb13c' : '#55d977'; g.beginPath(); g.roundRect(fx + 2 * s, fy + 2 * s, Math.max(0, (fw - 4 * s) * c.fuel), fh - 4 * s, 4 * s); g.fill();
    text('NITRO', fx, fy - 52 * s, 16, '#cfd6e4', 'left', 700);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < c.nitro ? '#59c8ff' : 'rgba(8,10,16,.6)';
      g.beginPath(); g.roundRect(fx + i * 36 * s, fy - 46 * s, 30 * s, 12 * s, 4 * s); g.fill();
    }
    if (c.nitroT > 0) { g.fillStyle = '#b9ecff'; g.fillRect(fx + 116 * s, fy - 46 * s, (c.nitroT / 3.5) * 100 * s, 12 * s); }

    // centre messages
    const mx = x0 + vw / 2, my = y0 + vh * 0.34;
    if (w.phase === 'countdown') {
      const lit = Math.floor(w.tick / 60);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = 'rgba(8,10,16,.75)'; g.beginPath(); g.arc(mx + (i - 1) * 74 * s, my, 32 * s, 0, 7); g.fill();
        g.fillStyle = i < lit ? '#ff3030' : '#3a0c0c'; g.beginPath(); g.arc(mx + (i - 1) * 74 * s, my, 24 * s, 0, 7); g.fill();
      }
    } else if (w.tick < COUNTDOWN_TICKS + 70 && !c.finished) text('GO!', mx, my + 30 * s, 110, '#5dff7a', 'center');
    else if (c.dnf) text('OUT OF FUEL', mx, my, 70, '#ff4d4d', 'center');
    else if (c.finished) { text('FINISH', mx, my - 10 * s, 80, '#ffd23c', 'center'); text(ORD(pos) + ' place', mx, my + 50 * s, 44, '#fff', 'center'); }
    else if (c.inPit) text(c.fuel < 0.995 ? 'PIT LANE · REFUELLING' : 'TANK FULL', mx, my, 40, '#ffd23c', 'center');
    else if (c.fuel <= 0) text('NO FUEL', mx, my, 60, '#ff4d4d', 'center');
    else if (low && blink) text('LOW FUEL · PIT ON THE RIGHT', mx, my, 34, '#ff8a6a', 'center');
    else if (c.lap === w.laps && w.laps > 1 && c.z < w.track.length * 0.05) text('FINAL LAP', mx, my, 60, '#fff', 'center');
    void cls; void extra.names;
    g.restore();
    if (v.rect[3] < 1 && v.rect[1] > 0) { g.fillStyle = '#05060a'; g.fillRect(0, y0 - 2, W, 4); }
  }
}
