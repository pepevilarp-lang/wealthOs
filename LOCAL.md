# Orbit en local

Requisitos: Node 22.

```bash
npm install
cp .env.example .env.local   # rellena las claves (mismas que en Vercel)
node dev-server.mjs          # → http://localhost:3000
```

`dev-server.mjs` imita Vercel: sirve los estáticos, ejecuta `api/*.js` con el mismo `req`/`res`
y aplica la reescritura de `vercel.json` (`/api/instinct/<ruta>` → `?route=<ruta>`).
No necesita cuenta de Vercel. Alternativa oficial: `npx vercel dev` (pide login y `vercel link`).

Comprobación rápida: `http://localhost:3000/api/health` dice qué variables faltan (sin mostrar valores).

## Ojo
- El cliente apunta al Supabase de producción (`SB_URL` en `index.html`). En local trabajas sobre
  los datos reales. Para un entorno de pruebas, crea otro proyecto de Supabase y cambia `SB_URL`/`SB_KEY`.
- Faltan en el repo los SQL que cita CLAUDE.md (`sql/user_kv.sql`, `sql/002_instinct.sql`,
  `sql/003_siri_notificaciones.sql`), además de `app.html`, `docs/PLAN.md` y `docs/INSTINCT.md`.
  Sin esos SQL no se puede recrear la base de datos desde cero.
- El cron de `/api/send-push` solo corre en Vercel; en local llámalo con
  `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/send-push`.
