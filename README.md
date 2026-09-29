# SELENE · El Arco de la Luna Eterna

Experiencia web inmersiva en WebGL inspirada en la ilustración del arco lunar del repositorio.
Todo se genera en el navegador: **sin modelos importados, sin texturas, sin audio pregrabado**.

## Cómo verla

Sirve la carpeta con cualquier servidor estático (los módulos ES no funcionan con `file://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

También funciona directamente en GitHub Pages (Three.js va incluido en `vendor/`, sin CDN).

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
index.html          — contenido y HUD
css/style.css       — diseño
js/main.js          — escena, cámara por capítulos, bucle
js/world/*          — cielo, arco, cuerda, partículas, líneas
js/game/*           — constelaciones y lógica del Ritual
js/audio.js         — motor de sonido
js/post.js          — post-procesado
vendor/three        — Three.js r186 (MIT)
```
