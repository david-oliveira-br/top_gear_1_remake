import { carMesh, type CarMesh } from './carmodel';

// Small dedicated WebGL renderer for the car models: bakes race sprites and draws the live showroom.
const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aN; layout(location=2) in float aMat;
uniform vec2 uYaw,uElev; uniform vec4 uFrame,uAxle; uniform float uPersp,uFlip;
out vec3 vN,vP,vL; out float vMat;
void main(){
  vec3 p=aPos, n=aN;
  if(aMat>15.5){ float cz=aMat>31.5?uAxle.z:uAxle.y, c=cos(uAxle.w), s=sin(uAxle.w); vec2 q=vec2(p.y-uAxle.x,p.z-cz); p.y=uAxle.x+q.x*c-q.y*s; p.z=cz+q.x*s+q.y*c; }
  p.y*=uFlip; n.y*=uFlip;
  vec3 w=vec3(p.x*uYaw.x+p.z*uYaw.y,p.y,-p.x*uYaw.y+p.z*uYaw.x);
  vN=vec3(n.x*uYaw.x+n.z*uYaw.y,n.y,-n.x*uYaw.y+n.z*uYaw.x); vP=w; vL=aPos; vMat=aMat;
  float xv=w.x, yv=w.y*uElev.x+w.z*uElev.y, d=-w.y*uElev.y+w.z*uElev.x;
  if(uPersp>0.5){ float zz=d+uFrame.w; gl_Position=vec4(xv*uFrame.x,(yv-uFrame.z)*uFrame.y,zz*1.0513-2.0513,zz); }
  else gl_Position=vec4(xv*uFrame.x,(yv-uFrame.z)*uFrame.y,d*0.1,1.);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vN,vP,vL; in float vMat; out vec4 o;
uniform vec3 uColor,uV; uniform float uEmis,uAlpha,uStudio,uFlip;
vec3 env(vec3 r){
  float y=r.y;
  vec3 day=y>0.?mix(vec3(0.8,0.86,0.94),vec3(0.2,0.4,0.74),smoothstep(0.,0.85,y)):mix(vec3(0.3,0.28,0.27),vec3(0.05),smoothstep(0.,-0.5,y));
  day+=vec3(1.3,1.25,1.1)*smoothstep(0.86,0.97,dot(r,normalize(vec3(-0.35,0.8,-0.45))));
  vec3 st=vec3(0.03,0.035,0.05)+vec3(0.9,0.95,1.1)*smoothstep(0.25,0.5,y)*smoothstep(0.95,0.7,y)*(0.35+0.65*smoothstep(0.3,0.9,abs(r.x)))
    +vec3(1.4)*smoothstep(0.9,0.98,dot(r,normalize(vec3(0.3,0.85,0.4))))+vec3(0.5,0.25,0.2)*smoothstep(0.1,-0.3,y)*0.15;
  return mix(day,st,uStudio);
}
void main(){
  int m=int(mod(vMat+0.5,16.));
  vec3 N=normalize(vN), V=normalize(uV), L=normalize(vec3(-0.45,0.75,-0.5)), H=normalize(L+V), R=reflect(-V,N);
  if(m==9){ // floor: soft contact shadow, plus a pool of light in the showroom
    float sh=0.62*smoothstep(1.,0.3,length(vec2(vL.x/1.12,vL.z/2.55)));
    float pool=uStudio*smoothstep(5.2,0.6,length(vL.xz));
    vec3 c=vec3(0.16,0.19,0.27)*pool*(1.-sh*1.3); float a=max(pool*0.75,sh);
    if(uEmis>0.5){ o=vec4(0.); return; }
    o=vec4(c,a); return;
  }
  float ndl=max(dot(N,L),0.), fres=0.05+0.95*pow(1.-max(dot(N,V),0.),5.), spec=pow(max(dot(N,H),0.),140.);
  vec3 hemi=mix(vec3(0.2,0.19,0.2),vec3(0.72,0.78,0.9),N.y*0.5+0.5)*mix(1.,0.9,uStudio);
  float ao=0.72+0.28*smoothstep(0.08,0.5,vL.y);
  vec3 e=env(R), col, em=vec3(0.);
  if(m==0) col=(uColor*(hemi*0.6+ndl*0.7)+e*uColor*0.14)*ao+e*fres*0.85+spec*1.1;
  else if(m==1) col=vec3(0.015,0.022,0.035)+e*(0.1+fres*0.9)+spec*0.7;
  else if(m==2) col=vec3(0.03)*(0.5+ndl)+e*fres*0.04;
  else if(m==3) col=vec3(0.5,0.52,0.56)*(0.35+0.65*ndl)+e*0.6+spec;
  else if(m==4) col=vec3(0.05,0.052,0.058)*(0.5+ndl)+e*fres*0.12;
  else if(m==5){ col=vec3(0.82,0.05,0.04)*(0.55+0.45*ndl)+e*fres*0.35+spec*0.5; em=vec3(1.,0.16,0.1); }
  else if(m==6){ col=vec3(0.95,0.93,0.85)*(0.6+0.4*ndl)+spec; em=vec3(1.,0.95,0.8)*0.5; }
  else if(m==7) col=vec3(0.9,0.9,0.86)*(0.45+0.55*ndl);
  else col=vec3(0.012);
  if(uEmis>0.5){ o=vec4(em,1.); return; }
  o=vec4(col*uAlpha,uAlpha);
}`;

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => Math.pow(c / 255, 1.6); // paint reads better slightly deepened
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

export class CarRenderer {
  gl: WebGL2RenderingContext; private p: WebGLProgram; private u: Record<string, WebGLUniformLocation | null> = {};
  private vaos = new Map<number, { vao: WebGLVertexArrayObject; mesh: CarMesh }>(); private floor: WebGLVertexArrayObject;

  constructor(public canvas: HTMLCanvasElement = document.createElement('canvas')) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true })!;
    this.gl = gl;
    const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('car shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = (this.p = gl.createProgram()!); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('car link: ' + gl.getProgramInfoLog(p));
    for (const n of ['uYaw', 'uElev', 'uFrame', 'uPersp', 'uFlip', 'uColor', 'uV', 'uAxle', 'uEmis', 'uAlpha', 'uStudio']) this.u[n] = gl.getUniformLocation(p, n);
    const q = 7, f: number[] = [];
    for (const [x, z] of [[-q, -q], [q, -q], [q, q], [-q, -q], [q, q], [-q, q]]) f.push(x, 0.004, z, 0, 1, 0, 9);
    this.floor = this.vao(new Float32Array(f));
  }
  private vao(data: Float32Array) {
    const gl = this.gl, v = gl.createVertexArray()!; gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null); return v;
  }
  private mesh(cls: number) {
    let m = this.vaos.get(cls);
    if (!m) { const mesh = carMesh(cls); m = { vao: this.vao(mesh.data), mesh }; this.vaos.set(cls, m); }
    return m;
  }

  /**
   * Draw one car into this renderer's canvas (which is resized to w x h pixels).
   * ortho: frame is widthM x heightM metres, centreY = view-space height of the frame centre.
   */
  draw(o: { cls: number; color: [number, number, number]; yaw: number; elev: number; w: number; h: number; emis?: boolean; studio?: boolean;
    /** draw into this part of the canvas only (x, y, w, h in pixels); the canvas itself stays w x h and is not cleared first */
    vp?: [number, number, number, number]; spin?: number;
    ortho?: { widthM: number; heightM: number; centreY: number }; persp?: { dist: number; fov: number; centreY: number } }) {
    const gl = this.gl, cv = this.canvas;
    if (cv.width !== o.w || cv.height !== o.h) { cv.width = o.w; cv.height = o.h; }
    gl.clearColor(0, 0, 0, o.emis ? 1 : 0);
    if (o.vp) { gl.viewport(o.vp[0], o.vp[1], o.vp[2], o.vp[3]); gl.enable(gl.SCISSOR_TEST); gl.scissor(o.vp[0], o.vp[1], o.vp[2], o.vp[3]); }
    else { gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, o.w, o.h); }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vw = o.vp ? o.vp[2] : o.w, vh = o.vp ? o.vp[3] : o.h;
    gl.useProgram(this.p); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const ce = Math.cos(o.elev), se = Math.sin(o.elev), u = this.u;
    gl.uniform2f(u.uYaw, Math.cos(o.yaw), Math.sin(o.yaw)); gl.uniform2f(u.uElev, ce, se);
    gl.uniform3f(u.uV, 0, se, -ce); gl.uniform3fv(u.uColor, o.color); gl.uniform1f(u.uEmis, o.emis ? 1 : 0); gl.uniform1f(u.uStudio, o.studio ? 1 : 0);
    if (o.persp) { const f = 1 / Math.tan(o.persp.fov / 2); gl.uniform1f(u.uPersp, 1); gl.uniform4f(u.uFrame, (f * vh) / vw, f, o.persp.centreY, o.persp.dist); }
    else { const fr = o.ortho!; gl.uniform1f(u.uPersp, 0); gl.uniform4f(u.uFrame, 2 / fr.widthM, 2 / fr.heightM, fr.centreY, 0); }
    const m = this.mesh(o.cls);
    gl.uniform4f(u.uAxle, m.mesh.axle[0], m.mesh.axle[1], m.mesh.axle[2], o.spin ?? 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (o.studio && !o.emis) { // mirrored car under the floor
      gl.disable(gl.BLEND); gl.uniform1f(u.uFlip, -1); gl.uniform1f(u.uAlpha, 0.2);
      gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.mesh.count); gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    gl.uniform1f(u.uFlip, 1); gl.uniform1f(u.uAlpha, 1);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.bindVertexArray(this.floor); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.mesh.count);
    gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST);
  }
}
