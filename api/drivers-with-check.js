// /api/drivers-with-check.js
// versão ajustada para usar o campo "data" (DATE) do Supabase

const SUPABASE_URL ='https://jnubttskgcdguoroyyzy.supabase.co';

const SERVICE_KEY ='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';

  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const TABLE_CHECKINS = "checkins";
const TABLE_DRIVERS  = "drivers";

const DECLINE_HOUR   = Number(process.env.DECLINE_HOUR ?? 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE ?? 30);

const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

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

function todayDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function supaPagedGet(path, query, selectRange = 1000) {
  const base = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(path)}?${query}`;
  let start = 0, all = [];
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
    const chunk = JSON.parse(txt || "[]");
    all.push(...chunk);
    if (chunk.length < selectRange) break;
    start += selectRange;
  }
  return all;
}

async function buildPayload() {
  const today = todayDate();

  // 1️⃣ CHECKINS do dia (filtra por coluna 'data')
  const selChk = encodeURIComponent("id_driver,driver,geofence_status,data,hora");
  const chkQ =
    `select=${selChk}&data=eq.${encodeURIComponent(today)}` +
    `&geofence_status=eq.DENTRO_RAIO`;

  const chkRows = await supaPagedGet(TABLE_CHECKINS, chkQ);
  const checked = new Set();
  for (const r of chkRows) {
    const id = normalizeId(r.id_driver);
    const name = norm(r.driver);
    if (id && name) checked.add(key(id, name));
  }

  // 2️⃣ TODOS DRIVERS
  const selDrv = encodeURIComponent("id_driver,driver,corridor");
  const drvRows = await supaPagedGet(TABLE_DRIVERS, `select=${selDrv}`);

  const base = [];
  for (const r of drvRows) {
    const id = normalizeId(r.id_driver);
    const name = norm(r.driver);
    const cor = norm(r.corridor);
    if (!id || !name) continue;
    const k = key(id, name);
    base.push({
      id,
      name,
      corridor: cor,
      inRef: checked.has(k),
    });
  }

  base.sort(
    (a, b) =>
      (a.corridor || "").localeCompare(b.corridor || "", "pt-BR") ||
      (a.name || "").localeCompare(b.name || "", "pt-BR")
  );

  return { ok: true, data: base, decline: { h: DECLINE_HOUR, m: DECLINE_MINUTE } };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const now = Date.now();
    if (cache.payload && now - cache.at < CACHE_TTL_MS)
      return res.status(200).json(cache.payload);

    const payload = await buildPayload();
    cache = { at: now, payload };
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[drivers-with-check] ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
