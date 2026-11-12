import { App } from './app';

const app = new App(document.getElementById('gl') as HTMLCanvasElement);
(window as any).__app = app;
app.start().catch((e) => { console.error(e); document.getElementById('ui')!.innerHTML = '<div class="load"><h2>Não foi possível iniciar</h2><div>' + String(e?.message ?? e) + '</div><div>Use um navegador recente com WebGPU ou WebGL2.</div></div>'; });
