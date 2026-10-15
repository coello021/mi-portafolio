import { createHash, timingSafeEqual } from 'node:crypto';
import { almacen, leerActual, codigosRutas, nombresRutas } from '../lib/almacen.mjs';
import { validar, comparar } from '../lib/reporte.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const sha = (s) => createHash('sha256').update(String(s)).digest();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Freno a intentos fallidos de PIN (mejor esfuerzo: la memoria no se comparte entre instancias).
const fallos = new Map();
function bloqueado(ip) { const f = fallos.get(ip); return f && f.n >= 5 && Date.now() - f.t < 15 * 60e3; }
function fallo(ip) { const f = fallos.get(ip); fallos.set(ip, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() }); }

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const pin = (process.env.ADMIN_PIN || '').trim();
  if (!pin) return json({ error: 'La subida no está configurada (falta ADMIN_PIN en Netlify).' }, 503);

  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'desconocida';
  if (bloqueado(ip)) return json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' }, 429);

  const texto = await req.text();
  if (texto.length > 600_000) return json({ error: 'El archivo es demasiado grande.' }, 413);
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { return json({ error: 'Cuerpo inválido.' }, 400); }

  if (!timingSafeEqual(sha(cuerpo.pin ?? ''), sha(pin))) { fallo(ip); await dormir(500); return json({ error: 'PIN incorrecto.' }, 401); }
  fallos.delete(ip);

  const v = validar(cuerpo.reporte, codigosRutas);
  if (!v.ok) return json({ error: 'El reporte no es válido.', detalles: v.errores }, 422);

  const actual = await leerActual();
  if (actual.aviso) return json({ error: 'No se pudo leer lo publicado (almacenamiento no disponible). No se aplicó nada.' }, 503);
  const nuevo = v.limpio;

  // Regla: nunca retroceder. El reporte debe ser más nuevo que lo publicado.
  if (new Date(nuevo.corte_iso) <= new Date(actual.corte_iso)) {
    return json({ error: 'Reporte rechazado: es más viejo (o igual) que lo publicado.',
      detalles: [`Corte del reporte: ${nuevo.corte}`, `Corte publicado: ${actual.corte}`] }, 409);
  }

  const dif = comparar(actual, nuevo, nombresRutas, new Date().toISOString());
  if (cuerpo.modo !== 'aplicar') return json({ ok: true, modo: 'previa', corte_nuevo: nuevo.corte, corte_actual: actual.corte, avisos: v.avisos, diferencias: dif });

  try {
    const s = await almacen();
    if (actual.origen === 'subido') await s.setJSON(`historial/${actual.corte_iso}__${Date.now()}`, actual);
    await s.setJSON('actual', { ...nuevo, subido: new Date().toISOString(), version: '1' });
    try { // conserva solo las últimas 10 versiones anteriores
      const { blobs } = await s.list({ prefix: 'historial/' });
      for (const b of blobs.map((x) => x.key).sort().slice(0, -10)) await s.delete(b);
    } catch {}
  } catch (e) {
    return json({ error: 'No se pudo guardar en el almacenamiento de Netlify. No se cambió nada.' }, 503);
  }
  return json({ ok: true, modo: 'aplicado', corte: nuevo.corte, diferencias: dif });
};

export const config = { path: '/api/cierres/subir' };
