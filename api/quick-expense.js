// /api/quick-expense — gasto rápido desde un Atajo de iOS / Siri / widget.
// Formatos: POST { token, amount, category, note } (atajo de Siri, sin cambios)
//          POST { token, amount, merchant, card } (automatización de Wallet/Apple Pay: categoría aprendida del comercio,
//                cuenta según la tarjeta, otras monedas al tipo del BCE; ver recordCardExpense en instinct.js)
// Se registra AL INSTANTE con las mismas reglas que Instinct (recordQuickExpense): efectivo una sola vez,
// control de concurrencia, origen "siri". Un reenvío inmediato del mismo gasto no se duplica.
// Si el registro falla, queda en la cola quick_expenses y la app lo recoge al abrir.
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE.
import { recordQuickExpense, recordCardExpense } from './instinct.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SB_URL || !SERVICE) return res.status(500).json({ error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE en Vercel' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'El cuerpo no es JSON válido' }); } }
  body = body || {};

  const token = String(body.token || '').trim();
  const isCard = body.merchant != null || body.card != null;
  const amount = Math.abs(parseFloat(String(body.amount ?? '').replace(',', '.')));
  const category = String(body.category || '').replace(/[<>]/g, '').trim().slice(0, 40);
  const note = body.note ? String(body.note).replace(/[<>]/g, '').slice(0, 120) : null;

  if (!token) return res.status(400).json({ error: 'Falta token' });
  if (!isCard && (!amount || isNaN(amount))) return res.status(400).json({ error: 'Importe inválido' });
  if (!isCard && !category) return res.status(400).json({ error: 'Falta categoría' });

  const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  try {
    const tr = await fetch(`${SB_URL}/rest/v1/quick_tokens?token=eq.${encodeURIComponent(token)}&select=user_id`, { headers: h });
    const trows = await tr.json();
    if (!tr.ok) return res.status(500).json({ error: 'No se pudo comprobar el token', detail: trows });
    if (!Array.isArray(trows) || !trows.length) return res.status(401).json({ error: 'Token inválido. Genera uno nuevo en Orbit → Gastos → Siri / Atajos.' });
    const user_id = trows[0].user_id;

    // Pago con tarjeta (Apple Pay): sin importe válido no se apunta ni se encola
    if (isCard) {
      try {
        const r = await recordCardExpense(user_id, { amount: body.amount, merchant: body.merchant, card: body.card, note, category: category || null });
        if (r.status === 200) return res.status(200).json({ ok: true, message: r.body.message, id: r.body.data && r.body.data.id, category: r.body.data && r.body.data.item && r.body.data.item.category });
        return res.status(r.status === 400 ? 400 : 502).json({ error: r.body && r.body.message });
      } catch (e) {
        console.error('[quick-expense] pago con tarjeta falló:', e);
        const amt = Math.abs(parseFloat(String(body.amount ?? '').replace(/[^\d.,]/g, '').replace(',', '.')));
        if (!amt) return res.status(500).json({ error: 'No se pudo apuntar el pago', detail: e.message });
        const ir = await fetch(`${SB_URL}/rest/v1/quick_expenses`, { method: 'POST', headers: { ...h, Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id, amount: amt, category: category || 'Altres', note: String(body.merchant || 'Pago con tarjeta').slice(0, 120) }) });
        if (!ir.ok) return res.status(500).json({ error: 'No se pudo guardar', detail: await ir.text(), cause: e.message });
        return res.status(202).json({ ok: true, queued: true, message: `Guardado en la cola: aparecerá en Orbit al abrir la app. (${e.message})` });
      }
    }

    // 1º intento: registro inmediato con las reglas de siempre
    let failure = null;
    try {
      const r = await recordQuickExpense(user_id, { amount, category, note });
      if (r.status === 200) return res.status(200).json({ ok: true, amount, category, message: r.body.message, id: r.body.data && r.body.data.id });
      failure = r.body && r.body.message;
    } catch (e) { failure = e.message; console.error('[quick-expense] registro inmediato falló:', e); }

    // 2º: respaldo en la cola, para que no se pierda
    const ir = await fetch(`${SB_URL}/rest/v1/quick_expenses`, {
      method: 'POST', headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id, amount, category, note }),
    });
    if (!ir.ok) return res.status(500).json({ error: 'No se pudo guardar', detail: await ir.text(), cause: failure });
    return res.status(202).json({ ok: true, queued: true, amount, category,
      message: `Guardado en la cola: aparecerá en Orbit al abrir la app. (${failure || 'registro diferido'})` });
  } catch (e) {
    return res.status(500).json({ error: 'Error de servidor', detail: String((e && e.message) || e) });
  }
}
