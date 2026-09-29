# SELENE · Fumigación y Limpieza Profesional

Sitio web inmersivo en WebGL para un servicio de **fumigación, control de plagas y limpieza**: cucarachas, roedores, termitas, mosquitos, hormigas, chinches, alacranes, murciélagos, desinfección, limpieza profunda, tapicería, cisternas, post-obra y planes para empresas. Incluye formulario de cotización y un mini-juego de puntería.

Todo el 3D se genera en el navegador: **sin modelos importados, sin texturas, sin audio pregrabado**.

**Configura tu contacto:** en `dev.html`, en el formulario `#quote-form`, rellena `data-whatsapp="521234567890"` (con código de país) o `data-email="tu@correo.com"` y ejecuta `npm run build`.

## Cómo verla

**Abre `index.html` con doble clic.** Es una versión autónoma (≈700 KB) con el CSS, el JavaScript y Three.js incluidos: funciona sin servidor, en cualquier hosting estático y en GitHub Pages.

### Desarrollo

`dev.html` carga el código fuente modular (`css/`, `js/`, `vendor/`). Los módulos ES no funcionan con `file://`, así que necesita un servidor:

```bash
npm run dev          # python3 -m http.server 8000 → http://localhost:8000/dev.html
```

Después de editar el código, regenera `index.html`:

```bash
npm install          # solo la primera vez (esbuild)
npm run build
```

## Qué hay dentro

| Sistema | Implementación |
| --- | --- |
| **Arco 3D procedural** | Tubo de sección variable con arista (geometría propia), palas doradas instanciadas, puntas extruidas, cristales facetados con shader propio, venas de energía por ruido simplex inyectadas en `MeshPhysicalMaterial`, flexión de palas en el vertex shader según la tensión. |
| **Cuerda viva** | Simulación **Verlet** a paso fijo (120 Hz) con restricciones pre-tensadas; se tensa, vibra y oscila al soltar. Se renderiza con una línea gruesa en espacio de pantalla (`GlowLine`). |
| **Arpa** | Si cruzas la cuerda con el cursor se detecta la intersección en espacio de pantalla, se aplica un impulso físico y suena una nota **Karplus-Strong**. |
| **Partículas GPU** | Buffer circular de 18 000 partículas; el movimiento se resuelve analíticamente en el vertex shader (`p0 + v(1-e^-kt)/k + ½gt²`), sin coste de CPU por frame. |
| **Cielo** | Nebulosa fbm horneada una sola vez en un cubemap, 7 000 estrellas con parpadeo, luna con cráteres procedurales, nubes billboard volumétricas, mapa de entorno PMREM generado desde el propio cielo. |
| **Post-procesado** | Bloom HDR + pase propio con aberración cromática, onda de choque, viñeta, grano y destello. |
| **El Ritual (juego)** | Tensado no lineal, balística con gravedad y viento solar, colisión por esfera barrida (sin *tunneling*), ventana de tiro *Perfecto*, combos, fatiga del brazo, disparo **Nova** con detonación en cadena, cometas móviles, 3 constelaciones con dificultad creciente y ranking final. |
| **Audio** | Web Audio 100 % sintético: dron, campanas FM, Karplus-Strong, ruido filtrado y reverb por convolución generada. |
| **Calidad adaptativa** | Mide los tiempos de frame y reduce el *pixel ratio* si el equipo no llega. |

## Controles del Ritual

- **Mantener** clic / dedo / `Espacio`: tensar · **Soltar**: disparar
- Apunta con el cursor · `Esc` para salir

## Estructura

```
index.html          — versión autónoma generada (no editar)
dev.html            — contenido y HUD (fuente)
tools/              — script de build autónomo
css/style.css       — diseño
js/main.js          — escena, cámara por capítulos, bucle
js/world/*          — cielo, arco, cuerda, partículas, líneas
js/game/*           — constelaciones y lógica del Ritual
js/audio.js         — motor de sonido
js/post.js          — post-procesado
vendor/three        — Three.js r186 (MIT)
```
