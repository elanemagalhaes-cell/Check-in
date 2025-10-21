// api/ping.js
export const config = { runtime: 'nodejs18.x', regions: ['gru1'] };

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ ok:false, msg:'Method not allowed' });

    return res.status(200).json({
      ok: true,
      ts: new Date().toISOString(),
      note: 'Ping OK — runtime Node 18 e região gru1'
    });
  } catch (e) {
    return res.status(500).json({ ok:false, msg: e.message || 'erro' });
  }
}
