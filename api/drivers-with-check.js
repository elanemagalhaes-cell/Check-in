// ====== ENV ======
const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co'; // ex: https://xxxx.supabase.co
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || "";

// Tabelas (podem ser sobrescritas por env)
const TABLE_CHECKINS  = 'https://docs.google.com/spreadsheets/d/1vll0cF3SE7gc1D2TFBzAQHis8FtFktYYKFIEZwLVZs0/edit?gid=571545522#gid=571545522';
const TABLE_ESCALADOS ='https://docs.google.com/spreadsheets/d/1OddoJTEd1ZS7jo5Jhu1KaWwJs12KMM0ARZEKgTAI3LU/edit?gid=1330043296#gid=1330043296';
// Horário-limite para "Declinou"
const DECLINE_HOUR   = Number(process.env.DECLINE_HOUR ?? 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE ?? 30);

// ====== Cache anti-martelo (20s) ======
const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

// ====== Utils ======
const norm = (s) => (s ?? "").toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, "");
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return "";
  d = d.replace(/^0+/, "").replace(/0+$/, "");
  return d || "0";
}
const key = (id, name) =>
  normalizeId(id).toUpperCase() + "||" + norm(name).toUpperCase();

/**
 * Retorna:
 *  - dOnly: data local (YYYY-MM-DD) — útil para coluna DATE
 *  - startUTC / endUTC: limites do dia local convertidos para UTC (com 'Z')
 */
function dayBoundsLocalToUTC() {
  const now = new Date();
  // meia-noite local
  const localMidnight = new Date(now);
  localMidnight.setHours(0, 0, 0, 0);

  // deslocamento local -> UTC em minutos
  const tzOffsetMin = localMidnight.getTimezoneOffset(); // ex.: BRT => +180
  const startUTC = new Date(localMidnight.getTime() + tzOffsetMin * 60000);
  const endUTC   = new Date(startUTC.getTime() + 24 * 60 * 60000 - 1000); // 23:59:59

  const yyyy = localMidnight.getFullYear();
  const mm = String(localMidnight.getMonth() + 1).padStart(2, "0");
  const dd = String(localMidnight.getDate()).padStart(2, "0");

  // ISO sem milissegundos
  const isoNoMs = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

  return {
    dOnly: `${yyyy}-${mm}-${dd}`,
    startUTC: isoNoMs(startUTC), // ex.: 2025-10-20T03:00:00Z
    endUTC:   isoNoMs(endUTC),   // ex.: 2025-10-21T02:59:59Z
  };
}

async function supaPagedGet(path, query, selectRange = 1000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Variáveis ausentes: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_KEY) nas envs da Vercel."
    );
  }
  const base = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(path)}?${query}`;
  let start = 0;
  const all = [];
  while (true) {
    const end = start + selectRange - 1;
    const r = await fetch(base, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Accept-Profile": "public",
        "Range-Unit": "items",
        Range: `${start}-${end}`,
      },
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Supabase ${path} (${r.status}): ${txt}`);
    const batch = JSON.parse(txt || "[]");
    all.push(...batch);
    if (batch.length < selectRange) break;
    start += selectRange;
  }
  return all;
}

async function getCheckinsHoje(startUTC, endUTC) {
  // geofence_status: ajuste aqui se você usa "DENTRO" em vez de "DENTRO_RAIO"
  const select = encodeURIComponent("id_driver,driver,geofence_status,created_at");
  const q =
    `select=${select}` +
    `&created_at=gte.${encodeURIComponent(startUTC)}` +
    `&created_at=lte.${encodeURIComponent(endUTC)}` +
    `&geofence_status=eq.DENTRO_RAIO`;
  return supaPagedGet(TABLE_CHECKINS, q);
}

async function getEscaladosHoje(dOnly, startUTC, endUTC) {
  const select = encodeURIComponent("id_driver,driver,corridor,data,created_at");

  // 1ª tentativa: coluna DATE "data"
  const qData = `select=${select}&data=eq.${encodeURIComponent(dOnly)}`;
  let rows = await supaPagedGet(TABLE_ESCALADOS, qData);

  // Fallback: se vier vazio, tenta por janela de created_at (timestamptz)
  if (!rows || rows.length === 0) {
    const qCreated =
      `select=${select}` +
      `&created_at=gte.${encodeURIComponent(startUTC)}` +
      `&created_at=lte.${encodeURIComponent(endUTC)}`;
    rows = await supaPagedGet(TABLE_ESCALADOS, qCreated);
  }
  return rows;
}

async function buildPayload() {
  const { dOnly, startUTC, endUTC } = dayBoundsLocalToUTC();

  // 1) CHECK-INS do dia
  const chkRows = await getCheckinsHoje(startUTC, endUTC);
  const done = new Set();
  for (const r of chkRows) {
    const id = normalizeId(r.id_driver);
    const name = norm(r.driver);
    if (id && name) done.add(key(id, name));
  }

  // 2) ESCALADOS do dia (data DATE ou created_at timestamptz)
  const escRows = await getEscaladosHoje(dOnly, startUTC, endUTC);

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

  // Ordenação estável
  base.sort(
    (a, b) =>
      (a.corridor || "").localeCompare(b.corridor || "", "pt-BR") ||
      (a.name || "").localeCompare(b.name || "", "pt-BR")
  );

  return { ok: true, data: base, decline: { h: DECLINE_HOUR, m: DECLINE_MINUTE } };
}

export default async function handler(req, res) {
  // CORS + preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const debug = String(req.query?.debug || "0") === "1";

  try {
    const now = Date.now();
    if (!debug && cache.payload && now - cache.at < CACHE_TTL_MS) {
      return res.status(200).json(cache.payload);
    }
    const payload = await buildPayload();
    cache = { at: now, payload };
    return res.status(200).json(payload);
  } catch (err) {
    const msg = (err && (err.message || err.toString())) || "unknown";
    return res.status(500).json({ ok: false, error: msg });
  }
}
