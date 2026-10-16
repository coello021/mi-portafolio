# Mapa de la Red de Sucursales Vidrí

Página web con mapa nocturno (Leaflet + OpenStreetMap) que, al elegir una sucursal, dibuja la **mejor ruta en vivo de TomTom** desde CD Nejapa: coloreada tramo por tramo según el tráfico real (fluido, leve, moderado, fuerte, cierre), con rutas alternativas, tiempo estimado para camión y aviso si TomTom se desvía de la ruta habitual. Además muestra cierres viales con fecha de vigencia y las indicaciones de la ruta habitual. Si no hay llave de TomTom, la página funciona igual con los tiempos estimados fijos y avisa que el tráfico en vivo está apagado.

## Cómo funciona la vista en vivo

- Al abrir la página, todas las rutas habituales se ven tenues, coloreadas por estado de cierres (Libre, Precaución, Afectada).
- Al elegir una sucursal, la página pide `/api/ruta?codigo=XX`: una sola consulta a TomTom que devuelve la ruta más rápida, hasta 2 alternativas y los tramos con demora de cada una. La ruta elegida se ilumina, con puntos que avanzan hacia la sucursal (solo indican el sentido, no son un camión real).
- **Accidentes, cierres y obras:** la página consulta `/api/incidentes` (API de incidentes de TomTom, la misma llave) y muestra, con texto, calle y horas, los que quedan a menos de 200 m de la ruta elegida, además de un punto de color en el mapa. La red mide más de 10,000 km², el máximo por consulta de TomTom, así que la función la divide en franjas; el resultado es igual para todos y se cachea 5 min. Si TomTom no incluye esta consulta en tu plan, o no responde, la página lo dice y el resto sigue funcionando. No se sabe de antemano qué tan completa es la cobertura en El Salvador: hay que comprobarla en la práctica.
- Los tramos sin color de demora no significan "vía libre garantizada": significan que TomTom no reporta demoras ahí en este momento.
- La página ya no dibuja las teselas de tráfico general de TomTom sobre todo el mapa (se quitaron los interruptores): solo se consulta la ruta y los incidentes de lo que se elige, lo que gasta mucha menos cuota. La función `/api/tiles` sigue en el proyecto por si se quiere volver a usar, pero la página no la llama.
- El panel solo filtra por zona (Todas, Gran San Salvador, Occidente, Oriente); no hay buscador de texto. Si la consulta en vivo falla, el panel muestra el motivo entre paréntesis (por ejemplo, "TomTom respondió 403").
- El mapa base es OpenStreetMap con un filtro de color oscuro aplicado en el navegador; no hay otro proveedor de mapas.

## Estructura

```
public/index.html            la página (todo el código del mapa)
public/data/sucursales.json  sucursales y CD
public/data/rutas.json       rutas (polilínea, pasos, tiempos fijos)
public/data/cierres.json     cierres viales (se edita a mano)
netlify/functions/           ruta (mejor ruta en vivo), incidentes, tiles, eta, estado, cierres (lee) y subir (recibe el reporte)
netlify/lib/tope.mjs         contador diario y lectura de la llave
netlify/lib/polilinea.mjs    codifica la geometría de la ruta para enviarla ligera
netlify.toml                 configuración de Netlify (reemplaza la de Astro)
tests/test.mjs               pruebas con TomTom simulado
```

## Paso 1 — Respaldar el portafolio Astro en una rama

Hazlo **antes** de subir nada. En una terminal (Git Bash o PowerShell):

```bash
git clone URL_DE_TU_REPO_ASTRO portafolio-astro
cd portafolio-astro
git checkout -b respaldo-astro
git push -u origin respaldo-astro
git checkout main        # si tu rama principal se llama master, usa master
```

Revisa en GitHub que exista la rama `respaldo-astro`. Ahí queda el portafolio viejo intacto.

## Paso 2 — Reemplazar el contenido por este proyecto

Dentro de `portafolio-astro` (rama `main`): borra todo **excepto la carpeta oculta `.git`**, copia el contenido de esta carpeta y sube:

```bash
git add -A
git commit -m "Mapa de la red de sucursales con tráfico en vivo"
git push
```

Netlify desplegará solo. Gracias a `netlify.toml`, ya no intentará construir Astro.
Para no gastar créditos de Netlify, haz pocos pushes: prueba primero en tu computadora (Paso 5).

## Paso 3 — Poner la llave de TomTom (solo en Netlify)

1. En Netlify abre tu sitio → **Site configuration → Environment variables → Add a variable**.
2. Nombre: `TOMTOM_API_KEY`. Valor: tu llave. Guarda.
3. Haz un nuevo despliegue (**Deploys → Trigger deploy → Deploy site**) para que las funciones la lean.

La llave nunca está en el código ni llega al navegador: las funciones la usan en el servidor.
**No actives la restricción por dominio/referer en TomTom**: las llamadas salen del servidor de Netlify, sin referer, y TomTom las rechazaría.

Como la llave se compartió en un chat, **rótala**: en TomTom regenera la llave, actualiza la variable en Netlify y vuelve a desplegar.

## Paso 4 — Cambiar el nombre del sitio (opcional)

Netlify → **Site configuration → General → Site details → Change site name**. La URL será `nombre.netlify.app`.

## Paso 5 — Probar en tu computadora

```bash
npm test                         # pruebas de las funciones y del botón de cierres (TomTom simulado)
cp .env.example .env             # pon tu llave en .env (no se sube a GitHub)
npx netlify dev                  # abre http://localhost:8888
```

Sin `.env` el sitio abre igual, con el aviso de tráfico apagado.

## Editar cierres viales

Edita `public/data/cierres.json`. Cada cierre tiene: `id`, `nombre`, `estado` (Libre/Precaución/Afectada), `tipo`, `lat`, `lon`, `radio_m`, `detalle`, `recomendacion`, `fuente` y `vigente_hasta` (`"AAAA-MM-DD"` o `null`). Los vencidos se dibujan atenuados y con la leyenda "Venció el…". VMT, MOP y FOVIAL no publican una API, por eso se mantienen a mano.

## Límites que conviene conocer

- **Caché:** las teselas y la ruta en vivo se cachean 5 min en el CDN de Netlify, así que muchos visitantes que miran la misma sucursal generan una sola llamada a TomTom.
- **Tope diario:** `TOPE_RUTA_DIA` (300), `TOPE_INC_DIA` (400), `TOPE_TESELAS_DIA` (1800) y `TOPE_ETA_DIA` (400) son de *mejor esfuerzo*: cada instancia serverless cuenta por separado, no es un tope exacto. El límite real es el gratuito de TomTom (revisa el vigente en developer.tomtom.com/pricing); al excederse responde 403 y la página vuelve a los tiempos fijos.
- **Alternativas:** `ALTERNATIVAS_RUTA` (0 a 3, por defecto 2) controla cuántas rutas alternativas se piden. Si TomTom no las acepta junto con el modo camión, se reintenta sin alternativas antes de caer a modo carro.
- **Netlify gratis:** puede usar créditos mensuales compartidos entre tus sitios; cada despliegue y el ancho de banda consumen. Revisa tu uso en Netlify → Billing.
- **Mapa base:** los mosaicos públicos de OpenStreetMap son para uso ligero; si el sitio crece, cambia a un proveedor de mosaicos.
- **Ruta en vivo ≠ ruta habitual:** TomTom calcula su propia ruta más rápida; puede diferir de la guardada en `rutas.json`. La página lo mide (porcentaje de coincidencia) y dibuja la habitual punteada cuando se desvían.
- **Semáforos:** TomTom no los modela; por eso se suma el margen de abajo.

## Subir el reporte de cierres (botón "Actualizar cierres")

En la pestaña **Cierres** hay un botón para subir el reporte JSON (`version`, `corte`, `cierres`, `rutas`).

- Pide un **PIN**, que se guarda en Netlify como variable de entorno `ADMIN_PIN` (o `adminPin2`), con alcance a Functions; de preferencia marcada como secreta. No lo escribas en ningún archivo ni lo compartas.
- **Nunca retrocede:** solo se acepta un reporte cuyo `corte` sea más nuevo que el publicado. Uno igual o más viejo se rechaza.
- Antes de aplicar muestra una **vista previa** (cierres nuevos, que se quitan, que cambian, rutas que cambian de estado) y avisa si el reporte omite cierres que seguían vigentes.
- Valida el formato: coordenadas dentro de El Salvador, estados válidos, fechas `AAAA-MM-DD`, tamaños máximos.
- Solo toma del reporte los cierres y el estado/afectación/recomendación de cada ruta; la geometría de las rutas no se toca.
- Guarda lo publicado en Netlify Blobs y conserva las últimas 10 versiones anteriores. Si Blobs no estuviera disponible en tu plan, el botón avisa y no cambia nada; el mapa sigue con los datos base.
- El PIN tiene un freno de 5 intentos fallidos por 15 minutos (de mejor esfuerzo, no es exacto entre instancias).
- El mapa muestra "Cierres y rutas: corte del …" y un aviso naranja si pasan más de 2 días sin actualizar.

Requiere Node 22 (`@netlify/blobs`), ya configurado en `netlify.toml`.

## Tiempo de viaje: perfil de camión y margen (estimado)

El tiempo en vivo se calcula con TomTom como **camión** y se le suma un **margen** por semáforos, paradas y maniobras, que TomTom no modela. Es un **estimado, no un dato exacto**: la página lo dice así. Se ajusta en Netlify (Environment variables, alcance Functions), sin tocar código; tras cambiar una, hay que volver a desplegar:

| Variable | Qué hace | Por defecto |
|---|---|---|
| `CAMION_VEL_MAX` | Velocidad máxima del camión (km/h) | 80 |
| `CAMION_PESO_KG` | Peso del camión (kg); 0 = sin restricciones de peso | 0 |
| `MARGEN_PORCENTAJE` | Margen sobre el tiempo de TomTom (0 a 200) | 20 |

El 20 % es una suposición inicial, no una medición. Para calibrarlo, compara con tiempos reales de tus viajes (GPS o bitácora) y ajusta `MARGEN_PORCENTAJE`. Si TomTom no acepta el modo camión para una ruta, se calcula como carro y la página lo indica.
