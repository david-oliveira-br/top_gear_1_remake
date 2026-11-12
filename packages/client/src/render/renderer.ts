import { CAR_CLASSES, CAR_COLORS, ROAD_W, SEG_LEN, wrapDiff, type World } from '../../../shared/src/index';
import { buildAtlas, type Atlas, type SpriteInfo } from '../art/atlas';
import type { Backdrop } from '../art/backdrops';
import { carMesh, type CarMesh } from '../art/carmodel';
import { hexRgb } from '../art/carrender';
import { CAR_U } from '../art/cars';
import type { Look } from './look';
import { BLUR_FS, BRIGHT_FS, CAR_FS, CAR_VS, POST_FS, QUAD_VS, ROAD_FS, ROAD_VS, SKY_FS, SPRITE_FS, SPRITE_VS } from './shaders';

const DRAW = 300, CAM_H = 1150, CAM_D = 1.05, CAM_D_FAST = 0.84, Y_OFF = 0.1, NEAR = 150, FAR = DRAW * SEG_LEN * 1.2;
/** Distance from the camera to the centre of the followed car. */
export const PLAYER_Z = 2650;
const MAX_SPRITES = 4000, SV = 10;

export interface View { car: number; rect: [number, number, number, number] } // x,y,w,h in 0..1, y from top
export interface RenderOpts { bloom: boolean; crt: boolean; scale: number; intro?: number }

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
  private car: Prog; private carVaos = new Map<number, { vao: WebGLVertexArrayObject; mesh: CarMesh }>(); private floorVao: WebGLVertexArrayObject;
  private spin = new Map<number, number>(); private paint = CAR_COLORS.map(hexRgb);
  private texFar: WebGLTexture | null = null; private texNear: WebGLTexture | null = null; private texLights: WebGLTexture | null = null; private backdrop: Backdrop | null = null;
  private intro = 1;
  private scene: Target | null = null; private depth: WebGLRenderbuffer | null = null;
  private b1: Target | null = null; private b2: Target | null = null;
  private segX = new Float32Array(DRAW + 1); private segDX = new Float32Array(DRAW + 1);
  private skyOff = [0, 0]; private blurAmt = [0, 0]; private lines = [0, 0]; private fringe = [0, 0]; private zoom = [0, 0]; private hz = [0, 0]; private camD = CAM_D;
  private prevSpeed = new Map<number, number>(); private braking = new Map<number, number>();
  private flash = 0; private lastT = 0;
  private list: { z: number; fn: () => void }[] = [];
  private nSpr = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.road = this.prog(ROAD_VS, ROAD_FS); this.sprite = this.prog(SPRITE_VS, SPRITE_FS); this.sky = this.prog(QUAD_VS, SKY_FS); this.car = this.prog(CAR_VS, CAR_FS);
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

    const q = [1.6, 3.2], fl: number[] = [];
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) fl.push(x * q[0], 0.02, z * q[1], 0, 1, 0, 64);
    this.floorVao = this.meshVao(new Float32Array(fl));
    this.atlas = buildAtlas();
    this.texBase = this.tex(this.atlas.base); this.texEmis = this.tex(this.atlas.emis);
  }

  private tex(c: HTMLCanvasElement, repeat = false, old: WebGLTexture | null = null) {
    const gl = this.gl;
    if (old) gl.deleteTexture(old);
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private meshVao(data: Float32Array) {
    const gl = this.gl, v = gl.createVertexArray()!; gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null); return v;
  }
  private carModel(cls: number, lod = false) {
    const key = cls + (lod ? 16 : 0);
    let m = this.carVaos.get(key);
    if (!m) { const mesh = carMesh(cls, lod); m = { vao: this.meshVao(mesh.data), mesh }; this.carVaos.set(key, m); }
    return m;
  }
  setBackdrop(b: Backdrop) {
    if (b === this.backdrop) return;
    this.backdrop = b;
    this.texFar = this.tex(b.far, true, this.texFar); this.texNear = this.tex(b.near, true, this.texNear); this.texLights = this.tex(b.lights, true, this.texLights);
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
    this.intro = opts.intro ?? 1;
    if (look.storm && Math.random() < dt * 0.12) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3.5);

    for (const c of world.cars) {
      const prev = this.prevSpeed.get(c.idx) ?? c.speed;
      const b = this.braking.get(c.idx) ?? 0;
      this.braking.set(c.idx, c.speed < prev - 12 ? 1 : Math.max(0, b - dt * 6));
      this.prevSpeed.set(c.idx, c.speed);
      const om = c.speed / (0.33 * CAR_U); // wheel speed in rad/s, eased so the spokes never strobe
      this.spin.set(c.idx, ((this.spin.get(c.idx) ?? 0) + 20 * Math.tanh(om / 20) * dt) % (Math.PI * 2));
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
    gl.uniform2f(P.u.uLines, this.lines[0], this.lines[1]); gl.uniform2f(P.u.uFringe, this.fringe[0], this.fringe[1]);
    gl.uniform1f(P.u.uTime, time); gl.uniform1f(P.u.uRain, look.rain); gl.uniform1f(P.u.uSnow, look.snow);
    gl.uniform1f(P.u.uCrt, opts.crt ? 1 : 0); gl.uniform1f(P.u.uBloomAmt, opts.bloom ? 0.85 : 0); gl.uniform1f(P.u.uFlash, this.flash);
    gl.uniform1f(P.u.uViews, views.length);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private common(p: Prog, look: Look, aspect: number) {
    const gl = this.gl;
    gl.uniform4f(p.u.uProj, this.camD / aspect, this.camD, Y_OFF, 0);
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
    const ik = this.intro, nit = me.nitroT > 0 ? 1 : 0, ease = Math.min(1, dt * 4);
    // the view opens up and the camera drops as speed builds; nitro kicks it further
    this.zoom[vi] += ((Math.min(1, sp) ** 1.5 + nit * 0.45) * ik - this.zoom[vi]) * ease;
    const zm = this.zoom[vi];
    this.camD = CAM_D + (CAM_D_FAST - CAM_D) * zm;
    const back = PLAYER_Z - zm * 420 + (1 - ik) * 15000;
    const camZ = mod(me.rz - back, L);
    const base = Math.floor(camZ / SEG_LEN) % N, basePct = (camZ % SEG_LEN) / SEG_LEN;
    const pSeg = segs[Math.floor(mod(me.rz, L) / SEG_LEN) % N], pPct = (mod(me.rz, L) % SEG_LEN) / SEG_LEN;
    const fast = Math.max(0, sp - 0.82) * 5.5 + nit * 0.6;
    const shake = (me.offroad && me.speed > 800 ? 14 : 0) + me.bump * 90 + fast * 5;
    const camY = CAM_H - zm * 190 + (1 - ik) * 5200 + pSeg.y1 + (pSeg.y2 - pSeg.y1) * pPct + Math.sin(time * 71) * shake;
    const camX = me.rx * ROAD_W * 0.9 * ik + Math.sin(time * 53) * fast * 4;
    this.skyOff[vi] += pSeg.curve * sp * dt * 0.42;
    this.blurAmt[vi] += ((Math.max(0, sp - 0.35) * 1.9 + nit * 1.6 + me.draft * 0.9) - this.blurAmt[vi]) * Math.min(1, dt * 5);
    this.lines[vi] += ((Math.max(0, sp - 0.72) * 2.4 + nit * 1.1) * ik - this.lines[vi]) * ease;
    this.fringe[vi] += (nit - this.fringe[vi]) * Math.min(1, dt * 6);
    // the horizon sinks on climbs and rises on descents
    const slope = (pSeg.y2 - pSeg.y1) / SEG_LEN;
    this.hz[vi] += (Math.max(-0.085, Math.min(0.085, -slope * 0.3)) * ik - this.hz[vi]) * Math.min(1, dt * 2.5);
    const bd = this.backdrop, dayK = 1 - look.night;

    // sky
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    const S = this.sky; gl.useProgram(S.p);
    gl.uniform4f(S.u.uRect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniform3fv(S.u.uTop, look.top); gl.uniform3fv(S.u.uHor, look.hor); gl.uniform3fv(S.u.uSunCol, look.sunCol);
    gl.uniform3f(S.u.uGround, look.grassA[0] * look.amb[0] * 0.2 + look.fog[0] * 0.8, look.grassA[1] * look.amb[1] * 0.2 + look.fog[1] * 0.8, look.grassA[2] * look.amb[2] * 0.2 + look.fog[2] * 0.8);
    gl.uniform3fv(S.u.uSkyAmb, look.skyAmb); gl.uniform3fv(S.u.uCloudCol, look.cloudCol);
    gl.uniform4f(S.u.uPano, 2.25, 0.62, 2.9, 0.8);
    gl.uniform4f(S.u.uFx, look.rain > 0 || look.snow > 0 ? 0 : dayK, bd?.balloons ? Math.min(1, dayK * 1.6) * (look.rain > 0 ? 0 : 1) : 0, bd?.searchlights ? look.night : 0, bd?.sea ? 1 : 0); gl.uniform1f(S.u.uLightLayer, this.backdrop?.lightsOnNear ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texFar); gl.uniform1i(S.u.uFar, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texNear); gl.uniform1i(S.u.uNear, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texLights); gl.uniform1i(S.u.uLightTex, 2);
    gl.uniform2f(S.u.uSun, look.sun[0], look.sun[1]); gl.uniform1f(S.u.uStars, look.stars); gl.uniform1f(S.u.uOff, this.skyOff[vi]);
    gl.uniform1f(S.u.uHorizon, 0.5 + Y_OFF / 2 + this.hz[vi]); gl.uniform1f(S.u.uCloud, look.cloud);
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
        const sh = spr.solid && info.w < 3200 && look.night < 0.6 ? at.shadow : null;
        this.list.push({ z, fn: () => { if (sh) this.quad(sh, X + info.w * 0.12, Y - 130, z + 2, info.w / 900, false, 0, 0, 0, 0.55, 0); this.quad(info, X, Y, z, 1, false, 1, 1, 1, 1, 0); } });
      }
    }
    const draws: { c: World['cars'][number]; X: number; Y: number; dz: number; cy: number; sy: number; cp: number; sp: number }[] = [];
    for (const c of world.cars) {
      const dz = wrapDiff(c.rz - camZ, L);
      if (dz < 1400 || dz > (DRAW - 2) * SEG_LEN) continue; // a car right at the lens would fill the screen
      const f = dz / SEG_LEN + basePct, n = Math.floor(f), fr = f - n, s = segs[(base + n) % N];
      const X = this.segX[n] + this.segDX[n] * fr - camX + c.rx * ROAD_W;
      const jit = (c.offroad && c.speed > 800 ? Math.sin(time * 60 + c.idx) * 18 : 0) + Math.sin(time * 80) * c.bump * 60;
      const Y = s.y1 + (s.y2 - s.y1) * fr - camY + jit + 6;
      // the car points along the road where it stands, plus its own steering
      const yaw = Math.atan2(this.segDX[n] + s.curve * fr, SEG_LEN) + c.steer * 0.11 * Math.min(1, c.speed / 2500);
      const pitch = Math.atan2(s.y2 - s.y1, SEG_LEN);
      const d = { c, X, Y, dz, cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch) };
      draws.push(d);
      const mesh = this.carModel(c.classId).mesh;
      /** car-local metres -> camera space */
      const at3 = (lx: number, ly: number, lz: number): [number, number, number] => {
        const y1 = ly * d.cp + lz * d.sp, z1 = -ly * d.sp + lz * d.cp;
        return [X + (lx * d.cy + z1 * d.sy) * CAR_U, Y + y1 * CAR_U, dz + (-lx * d.sy + z1 * d.cy) * CAR_U];
      };
      const brake = this.braking.get(c.idx) ?? 0, glow = at.glow, puff = at.puff, t = time;
      const tl = [at3(-mesh.tail.x, mesh.tail.y, mesh.tail.z - 0.05), at3(mesh.tail.x, mesh.tail.y, mesh.tail.z - 0.05)];
      const ex = [at3(-mesh.tail.x * 0.9, 0.3, mesh.tail.z - 0.1), at3(mesh.tail.x * 0.9, 0.3, mesh.tail.z - 0.1)];
      const rear = at3(0, 0, mesh.tail.z);
      this.list.push({
        z: dz, fn: () => {
          if (c.draft > 0.25 && c.idx === me.idx) {
            for (let k = 0; k < 6; k++) { const ph = (t * 2.2 + k * 0.17) % 1; this.quad(puff, X + (k % 2 ? 1 : -1) * (520 + k * 60), Y + 250 + Math.sin(k * 3) * 160, dz + 900 - ph * 1500, 0.35, false, 1, 1, 1, c.draft * 0.5 * (1 - Math.abs(ph - 0.5) * 2), 1); }
          }
          if (brake > 0.05 || look.night > 0.3) {
            const a = Math.max(brake * 0.55, look.night * 0.22);
            for (const p of tl) this.quad(glow, p[0], p[1], p[2] - 4, 0.75, false, 1, 0.12, 0.08, a, 1);
          }
          if (c.nitroT > 0) {
            const fl = 0.75 + 0.25 * Math.sin(t * 90 + c.idx);
            for (const p of ex) { this.quad(glow, p[0], p[1], p[2] - 6, 2.2 * fl, false, 0.3, 0.6, 1, 1, 1); this.quad(glow, p[0], p[1], p[2] - 7, 1.1, false, 1, 1, 1, 1, 1); }
          }
          const dusty = c.offroad && c.speed > 1200, spray = look.rain > 0 && c.speed > 3000;
          if (dusty || spray) {
            for (let k = 0; k < 4; k++) {
              const ph = (t * 3 + k * 0.25 + c.idx * 0.37) % 1;
              const px = rear[0] + (k % 2 ? 300 : -300) + Math.sin(k * 5 + c.idx) * 120;
              const col = dusty ? (look.snowy ? 1 : 0.62) : 0.9;
              this.quad(puff, px, rear[1] + ph * 260 - 200, rear[2] - 60 - ph * 2, 0.8 + ph * 1.6, false, col, col * (dusty && !look.snowy ? 0.85 : 1), col * (dusty && !look.snowy ? 0.65 : 1), (1 - ph) * (dusty ? 0.6 : 0.3), 0);
            }
          }
        },
      });
    }
    // car meshes: soft contact shadows first, then the bodies
    const C = this.car; gl.useProgram(C.p); this.common(C, look, aspect);
    gl.uniform3fv(C.u.uTop, look.top); gl.uniform3fv(C.u.uHor, look.hor); gl.uniform3fv(C.u.uSunCol, [look.sunCol[0] * dayK, look.sunCol[1] * dayK, look.sunCol[2] * dayK]);
    gl.uniform3f(C.u.uGround, (look.road[0] * 0.6 + look.grassA[0] * 0.4) * look.amb[0], (look.road[1] * 0.6 + look.grassA[1] * 0.4) * look.amb[1], (look.road[2] * 0.6 + look.grassA[2] * 0.4) * look.amb[2]);
    const sdx = (look.sun[0] - 0.5) * 1.4, sdy = 0.2 + look.sun[1] * 0.7, sdl = Math.hypot(sdx, sdy, 0.75);
    gl.uniform3f(C.u.uSunDir, sdx / sdl, sdy / sdl, 0.75 / sdl);
    gl.uniform1f(C.u.uNight, look.night); gl.uniform1f(C.u.uScale, CAR_U); gl.uniform1f(C.u.uShadow, 0.6 - 0.3 * look.night);
    const place = (d: (typeof draws)[number]) => { gl.uniform3f(C.u.uPos, d.X, d.Y, d.dz); gl.uniform4f(C.u.uRot, d.cy, d.sy, d.cp, d.sp); };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
    gl.bindVertexArray(this.floorVao);
    for (const d of draws) { place(d); gl.drawArrays(gl.TRIANGLES, 0, 6); }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND); gl.depthMask(true);
    for (const d of draws) {
      const m = this.carModel(d.c.classId, d.dz > 8000), c = d.c, om = c.speed / (0.33 * CAR_U);
      place(d);
      gl.uniform3fv(C.u.uColor, this.paint[c.color] ?? this.paint[0]);
      gl.uniform4f(C.u.uAxle, m.mesh.axle[0], m.mesh.axle[1], m.mesh.axle[2], this.spin.get(c.idx) ?? 0);
      gl.uniform1f(C.u.uSpinBlur, Math.min(1, om / 45)); gl.uniform1f(C.u.uBrake, this.braking.get(c.idx) ?? 0);
      gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.mesh.count);
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
    const yb = mode === 1 ? Y - h / 2 : Y, yt = yb + h;
    const put = (x: number, y: number, u: number, v: number) => { d[o++] = x; d[o++] = y; d[o++] = Z; d[o++] = u; d[o++] = v; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a; d[o++] = mode; };
    put(X - hw, yb, u0, s.v1); put(X + hw, yb, u1, s.v1); put(X - hw, yt, u0, s.v0); put(X + hw, yt, u1, s.v0);
  }
}
