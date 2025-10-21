// api/ping.js
// Simple health check to confirm Vercel runtime & region.
// Open: https://<seu-app>.vercel.app/api/ping

export const config = { runtime: 'nodejs18.x', regions: ['gru1'] }; // força Node 18 e região São Paulo (gru1)

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ ok:false, msg:'Method not allowed' });

    // retorno com informações úteis de diagnóstico
    return res.status(200).json({
      ok: true,
      ts: new Date().toISOString(),
      note: 'Ping OK — runtime Node 18 e região gru1',
    });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e.message || 'erro' });
  }
}
