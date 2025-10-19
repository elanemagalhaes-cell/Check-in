// api/drivers-with-check.js
export default async function handler(req, res) {
  // CORS básico
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // “Smoke test”: responde algo simples e válido em JSON
    const decline = { h: 14, m: 30 };

    // se quiser ver o “ping” funcionar direto no browser:
    // /api/drivers-with-check?ping=1
    if (req.query && req.query.ping) {
      return res.status(200).json({ ok: true, pong: true, decline });
    }

    // painel espera: { ok, data:[{id,name,corridor,inRef}], decline }
    const data = []; // vazio só para testar
    return res.status(200).json({ ok: true, data, decline });

  } catch (err) {
    console.error('[drivers-with-check] ERROR:', err);
    const msg = (err && (err.message || String(err))) || 'unknown';
    return res.status(500).json({ ok: false, msg });
  }
}
