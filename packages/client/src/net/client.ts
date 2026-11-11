import type { ClientMsg, ServerMsg } from '../../../shared/src/index';

export class NetClient {
  ws: WebSocket | null = null;
  id = 0; ping = 0;
  onMsg: (m: ServerMsg) => void = () => {};
  onBinary: (b: ArrayBuffer) => void = () => {};
  onClose: () => void = () => {};
  private pingTimer = 0;
  private lag = Number(new URLSearchParams(location.search).get('lag') || 0); // dev: artificial latency in ms

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  connect(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let done = false;
      ws.onopen = () => { this.send({ t: 'hello', name }); };
      ws.onerror = () => { if (!done) { done = true; reject(new Error('Could not reach the game server')); } };
      ws.onclose = () => { clearInterval(this.pingTimer); this.ws = null; if (!done) { done = true; reject(new Error('Could not reach the game server')); } else this.onClose(); };
      ws.onmessage = (ev) => {
        const handle = () => {
          if (typeof ev.data !== 'string') { this.onBinary(ev.data as ArrayBuffer); return; }
          let m: ServerMsg;
          try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'welcome') { this.id = m.id; done = true; resolve(); }
          else if (m.t === 'pong') this.ping = Math.round(performance.now() - m.c);
          else this.onMsg(m);
        };
        if (this.lag) setTimeout(handle, this.lag / 2); else handle();
      };
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
  }
  send(m: ClientMsg) { this.raw(JSON.stringify(m)); }
  sendBinary(b: ArrayBuffer) { this.raw(b); }
  private raw(d: string | ArrayBuffer) {
    const go = () => { if (this.connected) this.ws!.send(d); };
    if (this.lag) setTimeout(go, this.lag / 2); else go();
  }
  close() { this.ws?.close(); }
}
