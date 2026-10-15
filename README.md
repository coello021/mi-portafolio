# Mapa de la Red de Sucursales Vidrí

Página web con mapa interactivo (Leaflet + OpenStreetMap), rutas desde CD Nejapa con indicaciones paso a paso, cierres viales con fecha de vigencia y **tráfico en vivo de TomTom**. Si no hay llave de TomTom, la página funciona igual con los tiempos estimados fijos y avisa que el tráfico en vivo está apagado.

## Estructura

```
public/index.html            la página (todo el código del mapa)
public/data/sucursales.json  sucursales y CD
public/data/rutas.json       rutas (polilínea, pasos, tiempos fijos)
public/data/cierres.json     cierres viales (se edita a mano)
netlify/functions/           tiles, eta, estado, cierres (lee) y subir (recibe el reporte)
netlify/lib/tope.mjs         contador diario y lectura de la llave
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
npm test                         # 15 pruebas de las funciones (TomTom simulado)
cp .env.example .env             # pon tu llave en .env (no se sube a GitHub)
npx netlify dev                  # abre http://localhost:8888
```

Sin `.env` el sitio abre igual, con el aviso de tráfico apagado.

## Editar cierres viales

Edita `public/data/cierres.json`. Cada cierre tiene: `id`, `nombre`, `estado` (Libre/Precaución/Afectada), `tipo`, `lat`, `lon`, `radio_m`, `detalle`, `recomendacion`, `fuente` y `vigente_hasta` (`"AAAA-MM-DD"` o `null`). Los vencidos se dibujan atenuados y con la leyenda "Venció el…". VMT, MOP y FOVIAL no publican una API, por eso se mantienen a mano.

## Límites que conviene conocer

- **Caché:** las teselas se cachean 5 min y el tiempo en vivo 10 min en el CDN de Netlify, así que muchos visitantes generan pocas llamadas a TomTom.
- **Tope diario:** `TOPE_TESELAS_DIA` (1800) y `TOPE_ETA_DIA` (400) son de *mejor esfuerzo*: cada instancia serverless cuenta por separado, no es un tope exacto. El límite real es el gratuito de TomTom (revisa el vigente en developer.tomtom.com/pricing); al excederse responde 403 y la página vuelve a los tiempos fijos.
- **Netlify gratis:** puede usar créditos mensuales compartidos entre tus sitios; cada despliegue y el ancho de banda consumen. Revisa tu uso en Netlify → Billing.
- **Mapa base:** los mosaicos públicos de OpenStreetMap son para uso ligero; si el sitio crece, cambia a un proveedor de mosaicos.
- **Tiempo en vivo ≠ ruta dibujada:** TomTom calcula su propia ruta más rápida; puede diferir de la ruta guardada en `rutas.json`.

## Subir el reporte de cierres (botón "Actualizar cierres")

En la pestaña **Cierres** hay un botón para subir el reporte JSON (`version`, `corte`, `cierres`, `rutas`).

- Pide un **PIN**, que se guarda en Netlify como variable de entorno `ADMIN_PIN` (Functions y Runtime, secreta). No lo escribas en ningún archivo ni lo compartas.
- **Nunca retrocede:** solo se acepta un reporte cuyo `corte` sea más nuevo que el publicado. Uno igual o más viejo se rechaza.
- Antes de aplicar muestra una **vista previa** (cierres nuevos, que se quitan, que cambian, rutas que cambian de estado) y avisa si el reporte omite cierres que seguían vigentes.
- Valida el formato: coordenadas dentro de El Salvador, estados válidos, fechas `AAAA-MM-DD`, tamaños máximos.
- Solo toma del reporte los cierres y el estado/afectación/recomendación de cada ruta; la geometría de las rutas no se toca.
- Guarda lo publicado en Netlify Blobs y conserva las últimas 10 versiones anteriores. Si Blobs no estuviera disponible en tu plan, el botón avisa y no cambia nada; el mapa sigue con los datos base.
- El PIN tiene un freno de 5 intentos fallidos por 15 minutos (de mejor esfuerzo, no es exacto entre instancias).
- El mapa muestra "Cierres y rutas: corte del …" y un aviso naranja si pasan más de 2 días sin actualizar.

Requiere Node 22 (`@netlify/blobs`), ya configurado en `netlify.toml`.
