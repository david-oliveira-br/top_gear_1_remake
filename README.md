# Redline Horizon

Jogo de corrida 3D para navegador, feito com Three.js (`WebGPURenderer`, com queda automática para WebGL2).
Carreira "World Tour": corra, ganhe dinheiro e reputação, evolua o carro e destrave cidades. Esta é a fatia
vertical: Rio de Janeiro, um carro, cinco eventos.

Tudo é original: carro, pista, nomes e trilha. Os assets de céu, texturas e contornos do mapa são de domínio
público (ver `packages/game/public/assets/CREDITS.md`).

## Rodar

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # testes da simulação
npm run typecheck
npm run build
```

Use um navegador recente (Chrome/Edge). Em notebooks com duas placas de vídeo, faça o navegador usar a dedicada
(Configurações do Windows › Sistema › Vídeo › Elementos gráficos); na integrada o jogo só é jogável em "Baixa".

## Controles

| Ação | Teclado | Controle (PS / Xbox) |
|---|---|---|
| Direção | setas ou A/D | analógico esquerdo ou direcional |
| Acelerar / frear (ré) | ↑ / ↓ ou W / S | R2 / L2 (ou ✕ / ▢, A / X) |
| Nitro | Shift ou N | ○ / B ou R1 / RB |
| Freio de mão | Espaço | L1 / LB |
| Marchas (câmbio manual) | E / Q | △ / Y sobe, ↑ do direcional desce |
| Câmera | C | Select |
| Pausa · modo foto | Esc · P | Start |

## O que há

- **Física** própria e determinística a 60 Hz (`packages/sim`): pneus com ângulo de deriva, transferência de peso,
  curva de torque, turbo com atraso, câmbio, aerodinâmica, vácuo, nitro e controle de estabilidade.
- **Garagem**: 9 peças com 3 níveis (motor, turbo, câmbio, pneus, suspensão, freios, peso, aerodinâmica, nitro),
  dinamômetro com a curva antes/depois, ajuste de relação final, asa e freio, cores, acabamentos e rodas.
- **World Tour**: globo 3D com as cidades; o Rio tem corrida em grid, contra o relógio com fantasma, duelo, GP e
  o rival da cidade. As outras cidades aparecem bloqueadas (fase 2).
- **Gráficos**: céu HDR, sol com sombras, oclusão ambiente, bloom, desfoque de movimento, pintura com verniz,
  quatro níveis de qualidade.
- **Som**: motor sintetizado, trilha própria e rádio online — cole em Opções o endereço de stream de uma rádio
  que permita tocar em sites de terceiros. Nenhuma estação vem pré-configurada: as rádios que consultamos
  proíbem o uso em jogos sem autorização.

## Estrutura

- `packages/sim` — pista, carro, IA, corrida e carreira; sem dependência de renderização; testes em `test/`.
- `packages/game` — cliente: `gfx/` (renderizador), `world/` (Rio), `car/` (modelo), `race/`, `ui/`, `audio/`.
- `tools/` — download dos assets (`fetch-assets.mjs`), capturas e teste de ponta a ponta com o Chrome do Windows.
