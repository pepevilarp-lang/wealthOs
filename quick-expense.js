// /api/quick-expense — recibe un gasto desde un Atajo de iOS / Siri / widget
// y lo guarda en Supabase. Orbit lo recoge al abrir y lo mete en Gastos.
//
// REQUIERE en Vercel (Settings → Environment Variables):
//   SUPABASE_URL            = https://rjjfuzeapeasgdobnwbp.supabase.co
//   SUPABASE_SERVICE_ROLE   = (Supabase → Project Settings → API → service_role key)
// La service_role key NUNCA se expone al cliente: solo vive en el servidor.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Solo POST' }); return; }

  const SB_URL = process.env.SUPABASE_URL || 'https://rjjfuzeapeasgdobnwbp.supabase.co';
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SERVICE) { res.status(500).json({ error: 'Falta SUPABASE_SERVICE_ROLE en Vercel' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const token = (body.token || '').toString().trim();
  const amount = Math.abs(parseFloat(body.amount));
  const category = (body.category || '').toString().trim();
  const note = body.note ? body.note.toString().slice(0, 120) : null;

  if (!token) { res.status(400).json({ error: 'Falta token' }); return; }
  if (!amount || isNaN(amount)) { res.status(400).json({ error: 'Importe inválido' }); return; }
  if (!category) { res.status(400).json({ error: 'Falta categoría' }); return; }

  const h = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
  };

  try {
    // token -> user_id
    const tr = await fetch(
      `${SB_URL}/rest/v1/quick_tokens?token=eq.${encodeURIComponent(token)}&select=user_id`,
      { headers: h }
    );
    const trows = await tr.json();
    if (!Array.isArray(trows) || trows.length === 0) {
      res.status(401).json({ error: 'Token inválido. Genera uno nuevo en Orbit.' });
      return;
    }
    const user_id = trows[0].user_id;

    // insertar gasto
    const ir = await fetch(`${SB_URL}/rest/v1/quick_expenses`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id, amount, category, note }),
    });
    if (!ir.ok) {
      const detail = await ir.text();
      res.status(500).json({ error: 'No se pudo guardar', detail });
      return;
    }

    res.status(200).json({ ok: true, amount, category });
  } catch (e) {
    res.status(500).json({ error: 'Error de servidor', detail: String(e && e.message || e) });
  }
}
