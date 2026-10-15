import { llave } from '../lib/tope.mjs';

// Dice a la página si el tráfico en vivo está disponible (hay llave configurada).
export default async () => {
  return new Response(JSON.stringify({ trafico: llave().length > 0 }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
};

export const config = { path: '/api/estado' };
