# Asset credits

All files in this folder come from [Poly Haven](https://polyhaven.com) and are licensed CC0 (public domain), except `cars/CarConcept.glb` (CC BY 4.0, see the Car models section).

| File | Asset | Author |
|---|---|---|
| kloppenheim_06_puresky_4k.hdr | [Kloppenheim 06 (Pure Sky)](https://polyhaven.com/a/kloppenheim_06_puresky) | Greg Zaal, Jarod Guest |
| asphalt_04_*.jpg | [Asphalt 04](https://polyhaven.com/a/asphalt_04) | Jenelle van Heerden, Sergej Majboroda |
| aerial_grass_rock_*.jpg | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel |
| aerial_beach_01_*.jpg | [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) | Rob Tuytel |
| rock_face_03_*.jpg | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Dario Barresi, Rico Cilliers |
| concrete_wall_008_*.jpg | [Concrete Wall 008](https://polyhaven.com/a/concrete_wall_008) | Dario Barresi, Charlotte Baglioni |

## Car models

Licensed CC0 1.0 (public domain), from [Grab3D](https://grab3d.com).

| File | Asset | Source |
|---|---|---|
| cars/1990s-sports-car.glb | 1990s sports car | https://grab3d.com/models/vehicles/1990s-sports-car/ |
| cars/1980s-sports-car.glb | 1980s sports car | https://grab3d.com/models/vehicles/1980s-sports-car/ |
| cars/sports-car-cockpit-light.glb | sports car cockpit (interior, cockpit view only) | https://grab3d.com/models/vehicles/sports-car-cockpit/ |
Rádios (streams de terceiros tocados pelo navegador do jogador, fora do repositório): [Tuneria](https://tuneria.fm/flux), [ORBITA24](https://orbita24.it/), [RadiumFM World](https://radiumfm.com/world).
| cars/CarConcept.glb | **Car Concept** by Eric Chadwick (Darmstadt Graphics Group GmbH) for Khronos, 2024, from a public-domain model by Unity Fan; CC BY 4.0 (see below) | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept |

### Car Concept attribution (CC BY 4.0)

"Car Concept" by Eric Chadwick, Darmstadt Graphics Group GmbH (2024), distributed by the Khronos Group in glTF-Sample-Assets: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept . Started from the public-domain model "Free Concept Car 004" by Unity Fan, then optimised by Khronos. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes made for this game: the Khronos Group and 3D Commerce logos and the licence-plate texture are removed and replaced (blank plain-rubber sidewalls, a made-up plate), interior and under-body parts are hidden when not needed, paint, rims and lamps are recoloured at run time, and wheels are re-rigged to spin and steer. The licence excludes logos and trademarks; none are shown by this game.

### Sketchfab car models (selectable cars)

Converted by `tools/build-cars.mjs` (see `tools/cars.config.mjs`) into `cars/<id>.glb`; the original licence text of each model is kept in `cars/licenses/<id>.txt`. Modified for this game: nodes renamed and re-origined (+z forward, y up, metres, origin on the ground at the axle midpoint), canonical `wheel_FL/FR/RL/RR` nodes with the origin at each hub, materials renamed `paint` and `glass` (glass is made translucent and untextured), duplicate/damage meshes removed, meshes merged by material, welded and decimated, textures resized to 1024 px and re-encoded as WebP, Meshopt-compressed. Models are not otherwise altered, and no logos are added or removed.

| File | Model | Author | Source | Licence |
|---|---|---|---|---|
| cars/corvette.glb | 1962 chevrolet corvette grand sport | amogusstrikesback2 | https://sketchfab.com/3d-models/1962-chevrolet-corvette-grand-sport-e198431adc0c4694a8278e100e83894c | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| cars/cuda.glb | 1970 plymouth barracuda gen III | amogusstrikesback2 | https://sketchfab.com/3d-models/1970-plymouth-barracuda-gen-iii-f5c1ec18f8654546b9f76fd0082d7676 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| cars/mustang.glb | ford mustang gt fastback | amogusstrikesback2 | https://sketchfab.com/3d-models/ford-mustang-gt-fastback-c9862aa98a55471bb797a15e5c834dd9 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| cars/golf.glb | 1976 Volkswagen Golf GTI | OUTPISTON | https://sketchfab.com/3d-models/1976-volkswagen-golf-gti-c3569d9df6c74b86ad7751ffa407c160 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| cars/m635.glb | 1986 BMW M635CSi | OUTPISTON | https://sketchfab.com/3d-models/1986-bmw-m635csi-61d93770624847f08c940e16cf646eeb | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| cars/alfa155.glb | 1992 Alfa Romeo 155 Q4 | OUTPISTON | https://sketchfab.com/3d-models/1992-alfa-romeo-155-q4-9be37de2d57d4c93bd472637a42b9db3 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

Credit lines (as requested by the licence): "This work is based on "<title>" (<source>) by <author> licensed under <licence>", for each row above.

**Non-commercial notice:** the Golf GTI, BMW M635CSi and Alfa 155 Q4 models are CC BY-NC-SA 4.0. Use is non-commercial only, and the modified `golf.glb`, `m635.glb` and `alfa155.glb` are shared under the same licence. Remove these three models before any commercial release.
