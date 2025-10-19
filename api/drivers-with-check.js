// api/drivers-with-check.js
//
// Retorna a lista de escalados do dia com o status:
// - "checkin"  -> fez check-in hoje e está DENTRO_RAIO
// - "declined" -> não fez check-in até o horário limite (14:30 America/Sao_Paulo por padrão)
// - "none"     -> ainda dentro da janela, sem check-in
//
// Requer no Vercel:
// - SUPABASE_URL
// - SUPABASE_SERVICE_KEY
//
// Opcional via querystring:
// - cutoff=HH:MM     (ex.: ?cutoff=14:30)
// - tzOffset=MIN     (ex.: ?tzOffset=-180 para GMT-3)

const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';

// --- Helpers ---------------------------------------------------------------

const json = (res, code, data) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
};

const keyOf = (id, name) =>
  (String(id ?? '').replace(/\D+/g, '').replace(/^0+/, '') + '||' + String(name ?? '').trim().toUpperCase());

const todayRangeISO = (tzOffsetMin) => {
  // gera 00:00:00 e 23:59:59 do DIA local dado pelo offset
  // (server roda em UTC; ajustamos para "horário local")
  const nowUTC = Date.now();
  const base   = new Date(nowUTC + tzOffsetMin * 60 * 1000); // "agora" no fuso local
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  const startLocal = Date.UTC(y, m, d, 0, 0, 0);         // 00:00 local
  const endLocal   = Date.UTC(y, m, d, 23, 59, 59);      // 23:59:59 local

  // converte de volta pra UTC ISO
  const startUTC = new Date(startLocal - tzOffsetMin * 60 * 1000).toISOString();
  const endUTC   = new Date(endLocal   - tzOffsetMin * 60 * 1000).toISOString();

  // também devolve a data local YYYY-MM-DD para filtrar escalados_dia.data
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const yyyy_mm_dd = `${y}-${mm}-${dd}`;

  return { startUTC, endUTC, yyyy_mm_dd };
};

const supa = async (path, init = {}) => {
  const url = `${SUPABASE_URL}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Supabase ${resp.status} - ${txt}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : [];
};

// --- Core -------------------------------------------------------------------

async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(res, 500, { ok: false, msg: 'Variáveis SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes.' });
  }

  try {
    // parâmetros opcionais
    const url = new URL(req.url, 'http://localhost');
    const cutoffParam = (url.searchParams.get('cutoff') || '14:30').trim(); // HH:MM
    const tzOffsetMin = parseInt(url.searchParams.get('tzOffset') || '-180', 10); // padrão GMT-3 (São Paulo)

    const { startUTC, endUTC, yyyy_mm_dd } = todayRangeISO(tzOffsetMin);

    // 1) Escalados do dia (corridor, driver, id_driver)
    // Tabela: escalados_dia
    const escalados = await supa(
      `/rest/v1/escalados_dia?select=data,id_driver,driver,corridor&data=eq.${encodeURIComponent(yyyy_mm_dd)}`
    );

    // 2) Checkins do dia dentro do raio
    // Tabela: checkins
    const checkins = await supa(
      `/rest/v1/checkins?select=id_driver,driver,geofence_status,created_at` +
        `&geofence_status=eq.DENTRO_RAIO` +
        `&created_at=gte.${encodeURIComponent(startUTC)}` +
        `&created_at=lte.${encodeURIComponent(endUTC)}`
    );

    // 3) Dedup de checkins (primeira ocorrência por id+driver já basta)
    const checkedSet = new Set();
    for (const r of checkins) {
      const k = keyOf(r.id_driver, r.driver);
      if (k) checkedSet.add(k);
    }

    // 4) Calcula se já é hora de marcar "declined"
    const [hStr, mStr] = cutoffParam.split(':');
    const cutH = Math.max(0, Math.min(23, parseInt(hStr || '14', 10)));
    const cutM = Math.max(0, Math.min(59, parseInt(mStr || '30', 10)));

    const nowLocal = new Date(Date.now() + tzOffsetMin * 60 * 1000);
    const hasPassedCutoff =
      nowLocal.getUTCHours() > cutH ||
      (nowLocal.getUTCHours() === cutH && nowLocal.getUTCMinutes() >= cutM);

    // 5) Monta resposta cruzando escalados com checkins
    const rows = escalados.map((e) => {
      const k = keyOf(e.id_driver, e.driver);
      const didCheck = checkedSet.has(k);
      const status = didCheck ? 'checkin' : (hasPassedCutoff ? 'declined' : 'none');

      return {
        id_driver: String(e.id_driver ?? '').replace(/\D+/g, '').replace(/^0+/, ''),
        driver: (e.driver ?? '').trim(),
        corridor: (e.corridor ?? '').trim(),
        status
      };
    });

    // ordena por corredor e depois nome (opcional)
    rows.sort((a, b) =>
      (a.corridor || '').localeCompare(b.corridor || '') ||
      (a.driver   || '').localeCompare(b.driver   || '')
    );

    return json(res, 200, {
      ok: true,
      cutoff: cutoffParam,
      tzOffsetMin,
      date: yyyy_mm_dd,
      count: rows.length,
      rows
    });
  } catch (err) {
    return json(res, 500, { ok: false, msg: String(err && err.message || err) });
  }
}

// Vercel (Node serverless) aceita module.exports;
// se for Next.js API, o export default também funciona.
module.exports = handler;
export default handler;
