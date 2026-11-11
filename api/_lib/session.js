// Comprobación de sesión compartida por las funciones de /api (los archivos de _lib no son rutas).
// Valida el token de Supabase del usuario contra el propio servicio de autenticación y guarda el
// resultado unos minutos en memoria para no consultarlo en cada petición.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();   // token → { uid, until }

export async function sessionUser(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = (h.startsWith('Bearer ') ? h.slice(7) : '').trim();
  if (!token || token.split('.').length !== 3) return null;
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.uid;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE en Vercel');
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  if (cache.size > 500) cache.clear();
  cache.set(token, { uid: u.id, until: Date.now() + CACHE_MS });
  return u.id;
}
