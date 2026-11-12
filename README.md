# Redline Circuit

An original browser arcade racer in the style of 16-bit pseudo-3D racing games, with modern WebGL rendering,
synthesised music, controller support, split-screen and online multiplayer.

## Run

```bash
npm install
npm run dev        # game server (8787) + Vite dev client; open the URL Vite prints (5173, or the next free port)
```

Production (one process serves the game and the multiplayer server):

```bash
npm run build && npm start      # http://localhost:8787   (PORT=xxxx to change)
docker build -t redline . && docker run -p 8787:8787 redline
```

For internet play, host that process anywhere that allows WebSockets and share the URL; friends join with the 4-letter room code.

## Modes

- **Single race** – any of 32 tracks, 2–12 cars (2 = 1 vs 1 duel against the AI), weather/time overrides, 3 AI levels.
- **World tour** – 32 races through Brazil, USA, Japan, Norway, Italy, UK, Egypt and Australia (4 each), points table,
  1 or 2 players. Progress is saved in the browser, and the hub shows a resume code you can type on another machine.
- **Split-screen** – two players on one machine (two pads, pad + keyboard, or two keyboard layouts).
- **Online** – full-grid rooms (up to 12 humans, AI fills the rest) or 1 vs 1 duel rooms. The server is authoritative;
  a player who disconnects is replaced by the AI. Someone joining mid-race waits in the lobby for the next race.

## Driving

- **Showroom** – pick one of four cars (speed, acceleration, grip and fuel range differ), a colour and the gearbox. The car is a live 3D model; drag it with the mouse to spin it.
- **Perfect start** – during the lights, hold the revs inside the green band on the dial for a launch boost. Flat out gives wheelspin.
- **Slipstream** – tuck in behind another car at speed to gain a tow.
- **Contact** – cars alongside each other only nudge apart; only running into the back of a car costs speed.
- **Fuel** – the pit lane is on the right before the start line (yellow marker on the lap bar) and refuels as you drive through.
- **Changing sky** – some races go from dusk to night, or a storm arrives or clears, mid-race. Grip changes with it.
- **Music** – Options → Race music picks a song for races, or leave it on Auto for one theme per country.

## Controls

| Action | Keyboard | Xbox | PlayStation |
|---|---|---|---|
| Steer | ← → / A D | Left stick / D-pad | Left stick / D-pad |
| Accelerate / brake | ↑ ↓ / W S | RT / LT | R2 / L2 |
| Nitro | Space | A | ✕ |
| Shift up / down (manual) | X / Z | RB / LB | R1 / L1 |
| Pause | Esc | Menu | Options |

Pad buttons can be remapped in Options → Controller buttons. Split-screen keyboards: WASD + Left Shift + Q/E, and arrows + Right Shift + `,` `.`.
Browsers only expose a controller after a button is pressed on it, and only start audio after a key press or click.

## Layout

- `packages/shared` – deterministic 60 Hz simulation, tracks, AI, network protocol (used by client and server)
- `packages/client` – WebGL2 renderer, procedural art (cars are 3D models drawn in the scene, with spinning wheels; painted horizons carry a landmark for each circuit), Web Audio synth soundtrack and engine, input, menus
- `packages/server` – Node WebSocket rooms + static file server

## Checks

```bash
npm test                 # simulation + server integration (12 scripted clients run a full race)
npm run typecheck
node packages/client/smoke.mjs <screenshot-dir> <url>   # headless browser run against a running server
node packages/client/gallery.mjs <screenshot-dir> <url> 0 16 24   # screenshots of the showroom and given track numbers
node packages/client/audiocheck.mjs <url>                # plays every song and reports output level
```

URL flags: `?autopilot` (AI drives your car), `?padtest` (raw controller state), `?lag=150` (simulated network delay in ms).
