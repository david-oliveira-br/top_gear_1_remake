import { CAR_CLASSES, ROAD_W, SEG_LEN, wrapDiff, type World } from '../../../shared/src/index';
import { buildAtlas, carSprite, type Atlas, type SpriteInfo } from '../art/atlas';
import type { Look } from './look';
import { BLUR_FS, BRIGHT_FS, POST_FS, QUAD_VS, ROAD_FS, ROAD_VS, SKY_FS, SPRITE_FS, SPRITE_VS } from './shaders';

const DRAW = 300, CAM_H = 1150, CAM_D = 1.05, Y_OFF = 0.1, NEAR = 150, FAR = DRAW * SEG_LEN * 1.2;
export const PLAYER_Z = 1750;
const MAX_SPRITES = 4000, SV = 10;

export interface View { car: number; rect: [number, number, number, number] } // x,y,w,h in 0..1, y from top
export interface RenderOpts { bloom: boolean; crt: boolean; scale: number }

type Uni = Record<string, WebGLUniformLocation | null>;
interface Prog { p: WebGLProgram; u: Uni }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class Renderer {
  gl: WebGL2RenderingContext;
  atlas: Atlas;
  private road: Prog; private sprite: Prog; private sky: Prog; private bright: Prog; private blur: Prog; private post: Prog;
  private roadVao: WebGLVertexArrayObject; private roadBuf: WebGLBuffer; private roadData = new Float32Array(DRAW * 4 * 6);
  private sprVao: WebGLVertexArrayObject; private sprBuf: WebGLBuffer; private sprData = new Float32Array(MAX_SPRITES * 4 * SV);
  private quadVao: WebGLVertexArrayObject;
  private texBase: WebGLTexture; private texEmis: WebGLTexture;
  private scene: Target | null = null; private depth: WebGLRenderbuffer | null = null;
  private b1: Target | null = null; private b2: Target | null = null;
  private segX = new Float32Array(DRAW + 1); private segDX = new Float32Array(DRAW + 1);
  private skyOff = [0, 0]; private blurAmt = [0, 0];
  private prevSpeed = new Map<number, number>(); private braking = new Map<number, number>();
  private flash = 0; private lastT = 0;
  private list: { z: number; fn: () => void }[] = [];
  private nSpr = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.road = this.prog(ROAD_VS, ROAD_FS); this.sprite = this.prog(SPRITE_VS, SPRITE_FS); this.sky = this.prog(QUAD_VS, SKY_FS);
    this.bright = this.prog(QUAD_VS, BRIGHT_FS); this.blur = this.prog(QUAD_VS, BLUR_FS); this.post = this.prog(QUAD_VS, POST_FS);

    const quadIdx = (n: number) => { const a = new Uint16Array(n * 6); for (let i = 0; i < n; i++) a.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6); return a; };
    const mkVao = (data: Float32Array, n: number, attrs: number[]) => {
      const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const stride = attrs.reduce((a, b) => a + b, 0) * 4; let off = 0;
      attrs.forEach((s, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, s, gl.FLOAT, false, stride, off); off += s * 4; });
      const ib = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIdx(n), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, buf };
    };
    ({ vao: this.roadVao, buf: this.roadBuf } = mkVao(this.roadData, DRAW, [3, 3]));
    ({ vao: this.sprVao, buf: this.sprBuf } = mkVao(this.sprData, MAX_SPRITES, [3, 2, 4, 1]));
    this.quadVao = gl.createVertexArray()!; gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);

    this.atlas = buildAtlas();
    const tex = (c: HTMLCanvasElement) => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.texBase = tex(this.atlas.base); this.texEmis = tex(this.atlas.emis);
  }

  private prog(vs: string, fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u: Uni = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  private ensureTargets(w: number, h: number) {
    const gl = this.gl;
    if (this.scene && this.scene.w === w && this.scene.h === h) return;
    for (const t of [this.scene, this.b1, this.b2]) if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    this.scene = this.target(w, h);
    this.depth = gl.createRenderbuffer()!; gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.b1 = this.target(bw, bh); this.b2 = this.target(bw, bh);
  }

  render(world: World, views: View[], look: Look, time: number, opts: RenderOpts) {
    const gl = this.gl, cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * opts.scale;
    const W = Math.max(2, Math.round(cv.clientWidth * dpr)), H = Math.max(2, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.ensureTargets(W, H);
    const dt = Math.min(0.1, Math.max(0, time - this.lastT)); this.lastT = time;
    if (look.storm && Math.random() < dt * 0.12) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3.5);

    for (const c of world.cars) {
      const prev = this.prevSpeed.get(c.idx) ?? c.speed;
      const b = this.braking.get(c.idx) ?? 0;
      this.braking.set(c.idx, c.speed < prev - 12 ? 1 : Math.max(0, b - dt * 6));
      this.prevSpeed.set(c.idx, c.speed);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene!.fb);
    gl.enable(gl.SCISSOR_TEST);
    views.forEach((v, i) => {
      const x = Math.round(v.rect[0] * W), w = Math.round(v.rect[2] * W), h = Math.round(v.rect[3] * H), y = H - Math.round(v.rect[1] * H) - h;
      gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
      this.drawView(world, v.car, i, [x, y, w, h], look, time, dt);
    });
    gl.disable(gl.SCISSOR_TEST);

    // post
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);
    const b1 = this.b1!, b2 = this.b2!;
    if (opts.bloom) {
      gl.viewport(0, 0, b1.w, b1.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b1.fb); gl.useProgram(this.bright.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex);
      gl.uniform1i(this.bright.u.uTex, 0); gl.uniform2f(this.bright.u.uTexel, 1 / W, 1 / H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(this.blur.p); gl.uniform1i(this.blur.u.uTex, 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, b2.fb); gl.bindTexture(gl.TEXTURE_2D, b1.tex); gl.uniform2f(this.blur.u.uDir, (1 + i) / b1.w, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b1.fb); gl.bindTexture(gl.TEXTURE_2D, b2.tex); gl.uniform2f(this.blur.u.uDir, 0, (1 + i) / b1.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    const P = this.post; gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex); gl.uniform1i(P.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b1.tex); gl.uniform1i(P.u.uBloom, 1);
    gl.uniform2f(P.u.uRes, W, H); gl.uniform2f(P.u.uBlur, this.blurAmt[0], this.blurAmt[1]);
    gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uRain, look.rain); gl.uniform1f(P.u.uSnow, look.snow);
    gl.uniform1f(P.u.uCrt, opts.crt ? 1 : 0); gl.uniform1f(P.u.uBloomAmt, opts.bloom ? 0.85 : 0); gl.uniform1f(P.u.uFlash, this.flash);
    gl.uniform1f(P.u.uViews, views.length);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private common(p: Prog, look: Look, aspect: number) {
    const gl = this.gl;
    gl.uniform4f(p.u.uProj, CAM_D / aspect, CAM_D, Y_OFF, 0);
    gl.uniform2f(p.u.uDepth, (FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR));
    gl.uniform3fv(p.u.uFog, look.fog); gl.uniform1f(p.u.uFogDist, look.fogDist);
    gl.uniform3fv(p.u.uAmb, look.amb); gl.uniform1f(p.u.uHead, look.head);
  }

  private drawView(world: World, carIdx: number, vi: number, rect: number[], look: Look, time: number, dt: number) {
    const gl = this.gl, track = world.track, segs = track.segments, N = segs.length, L = track.length;
    const me = world.cars[carIdx] ?? world.cars[0];
    const aspect = rect[2] / rect[3];
    const cls = CAR_CLASSES[me.classId];
    const sp = me.speed / cls.top;
    const mod = (v: number, m: number) => ((v % m) + m) % m;
    const camZ = mod(me.rz - PLAYER_Z, L);
    const base = Math.floor(camZ / SEG_LEN) % N, basePct = (camZ % SEG_LEN) / SEG_LEN;
    const pSeg = segs[Math.floor(mod(me.rz, L) / SEG_LEN) % N], pPct = (mod(me.rz, L) % SEG_LEN) / SEG_LEN;
    const shake = (me.offroad && me.speed > 800 ? 14 : 0) + me.bump * 90;
    const camY = CAM_H + pSeg.y1 + (pSeg.y2 - pSeg.y1) * pPct + Math.sin(time * 71) * shake;
    const camX = me.rx * ROAD_W * 0.9;
    this.skyOff[vi] += pSeg.curve * sp * dt * 0.32;
    this.blurAmt[vi] += ((Math.max(0, sp - 0.55) * 1.6 + (me.nitroT > 0 ? 1.4 : 0)) - this.blurAmt[vi]) * Math.min(1, dt * 5);

    // sky
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    const S = this.sky; gl.useProgram(S.p);
    gl.uniform4f(S.u.uRect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform3fv(S.u.uTop, look.top); gl.uniform3fv(S.u.uHor, look.hor); gl.uniform3fv(S.u.uSunCol, look.sunCol); gl.uniform3fv(S.u.uGround, look.fog);
    gl.uniform3fv(S.u.uSil1, look.sil1); gl.uniform3fv(S.u.uSil2, look.sil2); gl.uniform3fv(S.u.uCloudCol, look.cloudCol);
    gl.uniform2f(S.u.uSun, look.sun[0], look.sun[1]); gl.uniform1f(S.u.uStars, look.stars); gl.uniform1f(S.u.uOff, this.skyOff[vi]);
    gl.uniform1f(S.u.uHorizon, 0.5 + Y_OFF / 2); gl.uniform1f(S.u.uSil, look.sil); gl.uniform1f(S.u.uCloud, look.cloud);
    gl.uniform1f(S.u.uTime, time); gl.uniform1f(S.u.uAurora, look.aurora); gl.uniform1f(S.u.uLights, look.night); gl.uniform1f(S.u.uFlash, this.flash);
    gl.bindVertexArray(this.quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // road geometry
    const rd = this.roadData, U = 400 * ROAD_W;
    let x = 0, dx = -(segs[base].curve * basePct), o = 0;
    for (let n = 0; n < DRAW; n++) {
      const i = (base + n) % N, s = segs[i];
      this.segX[n] = x; this.segDX[n] = dx;
      const z1 = (n - basePct) * SEG_LEN, z2 = z1 + SEG_LEN;
      const c1 = x - camX, c2 = x + dx - camX, y1 = s.y1 - camY, y2 = s.y2 - camY, pit = s.pit ? 1 : 0;
      rd[o++] = c1 - U; rd[o++] = y1; rd[o++] = z1; rd[o++] = -400; rd[o++] = i; rd[o++] = pit;
      rd[o++] = c1 + U; rd[o++] = y1; rd[o++] = z1; rd[o++] = 400; rd[o++] = i; rd[o++] = pit;
      rd[o++] = c2 - U; rd[o++] = y2; rd[o++] = z2; rd[o++] = -400; rd[o++] = i + 1; rd[o++] = pit;
      rd[o++] = c2 + U; rd[o++] = y2; rd[o++] = z2; rd[o++] = 400; rd[o++] = i + 1; rd[o++] = pit;
      x += dx; dx += s.curve;
    }
    this.segX[DRAW] = x;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    const R = this.road; gl.useProgram(R.p); this.common(R, look, aspect);
    gl.uniform3fv(R.u.uGrassA, look.grassA); gl.uniform3fv(R.u.uGrassB, look.grassB); gl.uniform3fv(R.u.uRoad, look.road);
    gl.uniform3fv(R.u.uRumA, look.rumA); gl.uniform3fv(R.u.uRumB, look.rumB); gl.uniform3fv(R.u.uSkyRef, look.hor);
    gl.uniform1f(R.u.uWet, look.wet); gl.uniform1f(R.u.uSnowy, look.snowy);
    gl.bindVertexArray(this.roadVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.roadBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rd);
    gl.drawElements(gl.TRIANGLES, DRAW * 6, gl.UNSIGNED_SHORT, 0);

    // sprites
    this.list.length = 0; this.nSpr = 0;
    const at = this.atlas.sprites;
    for (let n = 1; n < DRAW; n++) {
      const s = segs[(base + n) % N];
      if (!s.sprites.length) continue;
      const z = (n - basePct) * SEG_LEN, X0 = this.segX[n] - camX, Y = s.y1 - camY;
      for (const spr of s.sprites) {
        const info = at[spr.kind]; if (!info) continue;
        const X = X0 + spr.offset * ROAD_W;
        this.list.push({ z, fn: () => this.quad(info, X, Y, z, 1, false, 1, 1, 1, 1, 0) });
      }
    }
    for (const c of world.cars) {
      const dz = wrapDiff(c.rz - camZ, L);
      if (dz < 250 || dz > (DRAW - 2) * SEG_LEN) continue;
      const f = dz / SEG_LEN + basePct, n = Math.floor(f), fr = f - n, s = segs[(base + n) % N];
      const X = this.segX[n] + this.segDX[n] * fr - camX + c.rx * ROAD_W;
      const jit = (c.offroad && c.speed > 800 ? Math.sin(time * 60 + c.idx) * 18 : 0) + Math.sin(time * 80) * c.bump * 60;
      const Y = s.y1 + (s.y2 - s.y1) * fr - camY + jit;
      const ang = c.steer * 1.25 + Math.max(-1.4, Math.min(1.4, (X / dz) * 2.4));
      const frame = Math.min(2, Math.round(Math.abs(ang) * 1.6));
      const info = at[carSprite(c.classId, c.color, frame)];
      const flip = ang < 0, brake = this.braking.get(c.idx) ?? 0, glow = at.glow, puff = at.puff;
      const cz = dz, t = time;
      this.list.push({
        z: cz, fn: () => {
          this.quad(info, X, Y - 40, cz, 1, flip, 1, 1, 1, 1, 0);
          if (brake > 0.05 || look.night > 0.3) {
            const a = Math.max(brake * 0.8, look.night * 0.22);
            for (const sx of [-300, 300]) this.quad(glow, X + sx, Y + 170, cz - 5, 1.1, false, 1, 0.12, 0.08, a, 1);
          }
          if (c.nitroT > 0) {
            const fl = 0.75 + 0.25 * Math.sin(t * 90 + c.idx);
            for (const sx of [-170, 170]) { this.quad(glow, X + sx, Y + 20, cz - 6, 2.2 * fl, false, 0.3, 0.6, 1, 1, 1); this.quad(glow, X + sx, Y + 60, cz - 7, 1.1, false, 1, 1, 1, 1, 1); }
          }
          const dusty = c.offroad && c.speed > 1200, spray = look.rain > 0 && c.speed > 3000;
          if (dusty || spray) {
            for (let k = 0; k < 4; k++) {
              const ph = (t * 3 + k * 0.25 + c.idx * 0.37) % 1;
              const px = X + (k % 2 ? 300 : -300) + Math.sin(k * 5 + c.idx) * 120;
              const col = dusty ? (look.snowy ? 1 : 0.62) : 0.9;
              this.quad(puff, px, Y + ph * 260 - 40, cz - 8 - ph * 2, 0.8 + ph * 1.6, false, col, col * (dusty && !look.snowy ? 0.85 : 1), col * (dusty && !look.snowy ? 0.65 : 1), (1 - ph) * (dusty ? 0.6 : 0.3), 0);
            }
          }
        },
      });
    }
    this.list.sort((a, b) => b.z - a.z);
    for (const it of this.list) it.fn();
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const Sp = this.sprite; gl.useProgram(Sp.p); this.common(Sp, look, aspect);
    gl.uniform1f(Sp.u.uNight, look.night);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBase); gl.uniform1i(Sp.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texEmis); gl.uniform1i(Sp.u.uEmis, 1);
    gl.bindVertexArray(this.sprVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sprData, 0, this.nSpr * 4 * SV);
    gl.drawElements(gl.TRIANGLES, this.nSpr * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND);
  }

  /** Billboard with its bottom centre at camera-space (X,Y,Z). */
  private quad(s: SpriteInfo, X: number, Y: number, Z: number, scale: number, flip: boolean, r: number, g: number, b: number, a: number, mode: number) {
    if (this.nSpr >= MAX_SPRITES) return;
    const d = this.sprData; let o = this.nSpr++ * 4 * SV;
    const hw = (s.w * scale) / 2, h = s.h * scale;
    const u0 = flip ? s.u1 : s.u0, u1 = flip ? s.u0 : s.u1;
    const yb = mode ? Y - h / 2 : Y, yt = yb + h;
    const put = (x: number, y: number, u: number, v: number) => { d[o++] = x; d[o++] = y; d[o++] = Z; d[o++] = u; d[o++] = v; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a; d[o++] = mode; };
    put(X - hw, yb, u0, s.v1); put(X + hw, yb, u1, s.v1); put(X - hw, yt, u0, s.v0); put(X + hw, yt, u1, s.v0);
  }
}
