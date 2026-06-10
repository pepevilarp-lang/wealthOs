export default function handler(req, res) {
  // Debug: muestra qué ENV están disponibles (sin exponer valores)
  const has_pub = !!process.env.VAPID_PUBLIC;
  const has_priv = !!process.env.VAPID_PRIVATE;
  const pub_len = (process.env.VAPID_PUBLIC||'').length;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    key: process.env.VAPID_PUBLIC || '',
    _debug: { has_pub, has_priv, pub_len }
  });
}
