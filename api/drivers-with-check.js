// /api/drivers-with-check.js

// === Config via env ===
const SUPABASE_URL  = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';


const TABLE_CHECKINS  = process.env.TABLE_CHECKINS  || 'checkins';
const TABLE_ESCALADOS = process.env.TABLE_ESCALADOS || 'escalados_dia';

const DECLINE_HOUR   = Number(process.env.DECLINE_HOUR ?? 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE ?? 30);

// Cache anti-martelo (20s)
const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

// Utils
const norm = (s) => (s ?? '').toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, '');
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return '';
  d = d.replace(/^0+/, '').replace(/0+$/, '');
  return d || '0';
}
const key = (id, name) => (normalizeId(id).toUpperCase() + '||' + norm(name).toUpperCase());

function todayBounds() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const start = `${yyyy}-${mm}-${dd}T00:00:00`;
  const end   = `${yyyy}-${mm}-${dd}T23:59:59`;
  const dOnly = `${yyyy}-${mm}-${dd}`; // para coluna date
  return { start, end, dOnly };
}

async function supaPagedGet(path, query, selectRange = 1000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY no Vercel.');
  }
  const base = `${SUPABASE_URL}/rest/v1/${path}?${query}`;
  let start = 0;
  const all = [];
  while (true) {
    const end = start + selectRange - 1;
    const r = await fetch(base, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Accept-Profile': 'public',
        'Range-Unit': 'items',
        'Range': `${start}-${end}`
      }
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Supabase ${path} (${r.status}): ${txt}`);
    const batch = JSON.parse(txt || '[]');
    all.push(...batch);
    if (batch.length < selectRange) break;
    start += selectRange;
  }
  return all;
}

async function buildPayload() {
  const { start, end, dOnly } = todayBounds();

  // 1) CHECKINS do dia, apenas DENTRO_RAIO
  const selectCheckins = encodeURIComponent('id_driver,driver,geofence_status,created_at');
  const chkQ = `select=${selectCheckins}`
             + `&created_at=gte.${encodeURIComponent(start)}`
             + `&created_at=lte.${encodeURIComponent(end)}`
             + `&geofence_status=eq.DENTRO_RAIO`;
  const chkRows = await supaPagedGet(TABLE_CHECKINS, chkQ);

  const done = new Set();
  for (const r of chkRows) {
    const id = normalizeId(r.id_driver);
    const name = norm(r.driver);
    if (id && name) done.add(key(id, name));
  }

  // 2) ESCALADOS do dia (tabela escalados_dia tem coluna "data" (DATE), "id_driver", "driver", "corridor")
  const selectEsc = encodeURIComponent('id_driver,driver,corridor,data,created_at');
  const escQ = `select=${selectEsc}&data=eq.${encodeURIComponent(dOnly)}`;
  const escRows = await supaPagedGet(TABLE_ESCALADOS, escQ);

  const seen = new Set();
  const base = [];
  for (const r of escRows) {
    const id   = normalizeId(r.id_driver);
    const name = norm(r.driver);
    const cor  = norm(r.corridor);
    if (!id || !name) continue;
    const k = key(id, name);
    if (seen.has(k)) continue;
    seen.add(k);
    base.push({ id, name, corridor: cor, inRef: done.has(k) });
  }

  // Ordena por corredor/cage e depois nome
  base.sort((a,b) => (a.corridor || '').localeCompare(b.corridor || '', 'pt-BR') ||
                     (a.name     || '').localeCompare(b.name     || '', 'pt-BR'));

  return {
    ok: true,
    data: base,
    decline: { h: DECLINE_HOUR, m: DECLINE_MINUTE }
  };
}

export default async function handler(req, res) {
  // CORS e preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const now = Date.now();
    if (cache.payload && (now - cache.at) < CACHE_TTL_MS) {
      return res.status(200).json(cache.payload);
    }
    const payload = await buildPayload();
    cache = { at: now, payload };
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[drivers-with-check] ERROR:', err);
    const msg = (err && (err.message || err.toString())) || 'unknown';
    return res.status(500).json({ ok: false, msg });
  }
}
