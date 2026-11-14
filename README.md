# Redline Horizon

Jogo de corrida 3D para navegador, feito com Three.js (`WebGPURenderer`, com queda automática para WebGL2).
Carreira "World Tour": corra, ganhe dinheiro e reputação, evolua o carro e destrave cidades. Esta é a fatia
vertical: Rio de Janeiro, um carro, cinco eventos.

Tudo é original: carro, pista, nomes e trilha. Os assets de céu, texturas e contornos do mapa são de domínio
público (ver `packages/game/public/assets/CREDITS.md`).

Exceção: o carro do jogador é o "Car Concept" de Eric Chadwick (Darmstadt Graphics Group GmbH) para o Khronos Group, 2024, a partir de um modelo de domínio público de Unity Fan — licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), fonte <https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept>. Modificado: logotipos (Khronos, 3D Commerce) e placa removidos/substituídos, peças internas ocultadas, pintura, rodas e faróis recoloridos em tempo de execução. A licença exclui logotipos e marcas; nenhum é exibido.

Carros selecionáveis (modelos do Sketchfab, convertidos por `npm run build:cars` a partir de `assets/*.zip`): Corvette Grand Sport 1962, Plymouth Barracuda 1970 e Ford Mustang GT Fastback (amogusstrikesback2, CC BY 4.0); VW Golf GTI 1976, BMW M635CSi 1986 e Alfa Romeo 155 Q4 1992 (OUTPISTON, **CC BY-NC-SA 4.0 — uso não comercial apenas**; as versões modificadas seguem a mesma licença). Modificados: reorientados/reescalados, rodas separadas em nós `wheel_FL/FR/RL/RR`, materiais renomeados (`paint`, `glass`), malha simplificada, texturas a 1024 px (WebP) e compressão Meshopt. Autor, fonte e texto de licença de cada um em `packages/game/public/assets/CREDITS.md` e `packages/game/public/assets/cars/licenses/`. Para publicar ou vender o jogo, remova ou substitua os três modelos NC-SA.

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
| Câmera (perseguição, distante, para-choque, capô, cockpit) | C | Select |
| Olhar para trás (segure) | B | R3 (clique do analógico direito) |
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
- **Som**: motor sintetizado e rádio online de música feita por IA, trocável durante a corrida com **R** (ou ←/→ do
  direcional): MELODEATH.AI (metal, padrão), Tuneria (mix com hip hop, eletrônico, rock), ORBITA24 (rock/pop) e
  RadiumFM World (jazz), mais a trilha sintetizada do jogo e um campo para colar outro stream. Se a rádio cair, o jogo
  volta para a trilha sintetizada. Nenhuma dessas estações publica termos que autorizem uso em jogos (as que proíbem,
  como a MusicRadio.ai e a London AI Radio, ficaram de fora); o jogo trata como audição pessoal e não comercial e mostra
  o nome da estação. Para publicar ou vender o jogo, peça permissão às estações ou troque a fonte. Não há rádio de surf
  music gerada por IA com stream aberto.

## Estrutura

- `packages/sim` — pista, carro, IA, corrida e carreira; sem dependência de renderização; testes em `test/`.
- `packages/game` — cliente: `gfx/` (renderizador), `world/` (Rio), `car/` (modelo), `race/`, `ui/`, `audio/`.
- `tools/` — download dos assets (`fetch-assets.mjs`), capturas e teste de ponta a ponta com o Chrome do Windows.
