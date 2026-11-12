import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, normalView, uniform, screenUV, vec2, vec3, float, mix, smoothstep, saturation } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

export interface Quality { id: string; label: string; scale: number; shadow: number; bloom: boolean; blur: boolean; ao: boolean; far: number; detail: number; }
export const QUALITIES: Quality[] = [
  { id: 'low', label: 'Baixa', scale: 0.7, shadow: 1024, bloom: false, blur: false, ao: false, far: 0.6, detail: 0.4 },
  { id: 'medium', label: 'Média', scale: 1, shadow: 2048, bloom: true, blur: false, ao: false, far: 0.8, detail: 0.7 },
  { id: 'high', label: 'Alta', scale: 1, shadow: 4096, bloom: true, blur: true, ao: true, far: 1, detail: 1 },
  { id: 'ultra', label: 'Ultra', scale: 2, shadow: 4096, bloom: true, blur: true, ao: true, far: 1, detail: 1 },
];

/** Owns the WebGPU renderer and the post-processing chain for one scene + camera. */
export class Engine {
  renderer: THREE.WebGPURenderer; scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
  quality: Quality = QUALITIES[2]; backend = '';
  /** 0..1 strength of the speed blur, and of the vignette */
  blur = uniform(0); vignette = uniform(0.35); exposure = 0.82;
  private pipeline!: THREE.RenderPipeline; private w = 0; private h = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  }
  async init(q: Quality) {
    await this.renderer.init();
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.shadowMap.enabled = true;
    this.setQuality(q);
  }
  setQuality(q: Quality) {
    this.quality = q; this.w = 0;
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, velocity, normal: normalView }));
    let col: any = scenePass.getTextureNode('output');
    if (q.blur) col = motionBlur(col, scenePass.getTextureNode('velocity').mul(this.blur));
    if (q.ao) {
      const a = ao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), this.camera);
      a.resolutionScale = 0.5; a.radius.value = 0.6; a.distanceExponent.value = 1.4; a.thickness.value = 1.2;
      const clean: any = denoise(a.getTextureNode(), scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), this.camera);
      col = col.mul(mix(float(1), clean.r, 0.8));
    }
    if (q.bloom) col = col.add(bloom(col, 0.16, 0.35, 3.2));
    // filmic finish: gentle vignette and a touch more colour
    const d = screenUV.sub(vec2(0.5)).length();
    col = saturation(col, 1.08).mul(mix(float(1), smoothstep(0.95, 0.3, d), this.vignette));
    this.pipeline = new THREE.RenderPipeline(this.renderer, col);
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * (this.quality.scale > 1 ? 1 : this.quality.scale) * (this.quality.scale > 1 ? Math.max(1, Math.min(this.quality.scale, 2160 / h)) : 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  render() { this.resize(); this.renderer.toneMappingExposure = this.exposure; this.pipeline.render(); }
}
export { vec3 };
