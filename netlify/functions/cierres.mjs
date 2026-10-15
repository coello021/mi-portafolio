import { leerActual } from '../lib/almacen.mjs';

// Cierres y estado de rutas publicados (último reporte subido, o los datos base).
export default async () => {
  const a = await leerActual();
  const cache = a.aviso
    ? { 'Cache-Control': 'no-store' }
    : { 'Cache-Control': 'public, max-age=30', 'Netlify-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' };
  return new Response(JSON.stringify(a), { headers: { 'Content-Type': 'application/json', ...cache } });
};

export const config = { path: '/api/cierres' };
