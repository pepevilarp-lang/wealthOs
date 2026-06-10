// Devuelve la clave pública VAPID al cliente (no es secreta).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ key: process.env.VAPID_PUBLIC || '' });
}
