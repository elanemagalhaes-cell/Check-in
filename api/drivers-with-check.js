// API: /api/drivers-with-check
// Lê "escalados_dia" e "checkins" no Supabase e retorna JSON pronto para o painel.

function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function key(id, name) {
  const norm = (s) => (s ?? '').toString().trim();
  const onlyDigits = (s) => norm(s).replace(/\D+/g, '');
  const idN = onlyDigits(id).replace(/^0+/, '').replace(/0+$/, '') || '';
  return (idN + '||' + norm(name)).toUpperCase();
}

function todayRangeISO(tzOffsetMin = 0) {
  // Considera timezone local do servidor + offset opcional (se quiser forçar BR)
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  // Aplica offset manual se necessário (mantive 0 — o Supabase trata por UTC)
  return {
    startISO: start.toISOString().slice(0, 19),
    endISO: end.toISOString().slice(0, 19),
  };
}

async function fetchJSON(url, headers) {
  const r = await fetch(url, { headers });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  if (!r.ok) {
    // Mensagem clara de erro de backend (aparece nos Logs)
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
  }
  if (ct.includes('application/json')) return JSON.parse(text);
  // Se voltar HTML/texto, falamos explicitamente
  throw new Error(`Invalid content-type "${ct}": ${text.slice(0, 300)}`);
}

export default async function handler(req, res) {
  // CORS simples
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  try {
    const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
    const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';


    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('[drivers-with-check] Missing env SUPABASE_URL or SUPABASE_SERVICE_KEY');
      return json(res, 500, { ok: false, msg: 'Supabase env vars missing (URL/Service Key).' });
    }

    const hdr = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': 'public',
      'Content-Type': 'application/json',
    };

    const { startISO, endISO } = todayRangeISO(0);

    // 1) Escalados do dia
    // Tabela: escalados_dia  (campos: id_driver, driver, corridor, data)
    const escUrl =
      `${SUPABASE_URL}/rest/v1/escalados_dia` +
      `?select=id_driver,driver,corridor,data` +
      `&data=eq.${encodeURIComponent(startISO.slice(0, 10))}`; // data = yyyy-mm-dd
    const escalados = await fetchJSON(escUrl, hdr);

    // 2) Checkins hoje dentro do raio (DENTRO_RAIO)
    // Tabela: checkins (campos: id_driver, driver, geofence_status, created_at)
    const chkUrl =
      `${SUPABASE_URL}/rest/v1/checkins` +
      `?select=id_driver,driver,geofence_status,created_at` +
      `&created_at=gte.${encodeURIComponent(startISO)}&created_at=lte.${encodeURIComponent(endISO)}` +
      `&geofence_status=eq.DENTRO_RAIO`;
    const checkins = await fetchJSON(chkUrl, hdr);

    // Mapa de quem fez checkin
    const done = new Set(
      (checkins || []).map((r) => key(r.id_driver, r.driver))
    );

    // Monta saída para o painel
    const data = (escalados || [])
      .filter((r) => r && (r.id_driver || r.driver)) // sanity
      .map((r) => ({
        id: (r.id_driver ?? '').toString().trim(),
        name: (r.driver ?? '').toString().trim(),
        corridor: (r.corridor ?? '').toString().trim(),
        inRef: done.has(key(r.id_driver, r.driver)),
      }))
      .sort((a, b) =>
        (a.corridor || '').localeCompare(b.corridor || '', 'pt-BR') ||
        (a.name || '').localeCompare(b.name || '', 'pt-BR')
      );

    // Horário de "Declinou"
    const decline = { h: 14, m: 30 };

    return json(res, 200, { ok: true, data, decline });
  } catch (err) {
    console.error('[drivers-with-check] ERROR:', err);
    return json(res, 500, { ok: false, msg: String(err && (err.message || err)) });
  }
}

// Compatibilidade com CommonJS (Vercel/Node)
module.exports = handler;
