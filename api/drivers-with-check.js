// /api/drivers-with-check.js
// Preenche corridor via "PROCV": escalados_dia(data=hoje) -> fallback drivers

const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';

  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const T_CHECKINS      = "checkins";
const T_DRIVERS       = "drivers";
const T_ESCALADOS_DIA = "escalados_dia";

const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

// ---------- Utils ----------
const norm = (s) => (s ?? "").toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, "");
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return "";
  d = d.replace(/^0+/, "").replace(/0+$/, "");
  return d || "0";
}
function todayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseTimeToSec(t) {
  if (!t) return Number.MAX_SAFE_INTEGER;
  const m = String(t).match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const h = +m[1], mi = +m[2], s = +m[3], frac = +(m[4] || 0);
  return h*3600 + mi*60 + s + (m[4] ? frac / 10**m[4].length : 0);
}
async function supaPagedGet(path, query, page = 2000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY/KEY nas envs da Vercel.");
  }
  const base = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(path)}?${query}`;
  let start = 0, all = [];
  while (true) {
    const end = start + page - 1;
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
    if (batch.length < page) break;
    start += page;
  }
  return all;
}
function mapDriverRow(r) {
  const id = normalizeId(r.id_driver);
  const name = norm(r.driver ?? r.driver_name ?? r.nome ?? "");
  const corridor = norm(r.corridor ?? r.corridor_cage ?? r.cage ?? "");
  return { id, name, corridor };
}

// ---------- Core ----------
async function buildPayload() {
  const today = todayDate();

  // 1) Check-ins do dia (usa coluna DATE 'data' + hora)
  const selChk = encodeURIComponent("id_driver,driver,data,hora,geofence_status");
  const qChk =
    `select=${selChk}&data=eq.${encodeURIComponent(today)}` +
    `&geofence_status=eq.DENTRO_RAIO`;
  const chkRows = await supaPagedGet(T_CHECKINS, qChk);

  // earliest check-in por (id, name)
  const earliest = new Map(); // k -> {hora, horaSec}
  for (const r of chkRows) {
    const id = normalizeId(r.id_driver);
    const name = norm(r.driver);
    if (!id || !name) continue;
    const k = id.toUpperCase() + "||" + name.toUpperCase();
    const s = parseTimeToSec(r.hora);
    const prev = earliest.get(k);
    if (!prev || s < prev.horaSec) earliest.set(k, { hora: r.hora, horaSec: s });
  }

  // 2) "PROCV" do corredor do dia: escalados_dia (data=hoje)
  //    (se sua tabela tiver muitas linhas, isso é leve: só o dia)
  const selEsc = encodeURIComponent("id_driver,corridor,data");
  const qEsc = `select=${selEsc}&data=eq.${encodeURIComponent(today)}`;
  const escRows = await supaPagedGet(T_ESCALADOS_DIA, qEsc);
  const corridorById = new Map(); // id -> corridor (do dia)
  for (const r of escRows) {
    const id = normalizeId(r.id_driver);
    const cor = norm(r.corridor);
    if (id && cor) corridorById.set(id, cor);
  }

  // 3) Base: todos os drivers (com fallback de corridor do próprio drivers)
  const drvRows = await supaPagedGet(T_DRIVERS, `select=*`);
  const rows = [];
  for (const rr of drvRows) {
    const { id, name, corridor: corridorFromDrivers } = mapDriverRow(rr);
    if (!id || !name) continue;

    // corredor = primeiro tenta escalados_dia(hoje), senão usa drivers
    const corridor =
      corridorById.get(id) ||
      corridorFromDrivers ||
      ""; // vazio se não achou

    const k = id.toUpperCase() + "||" + name.toUpperCase();
    const hit = earliest.get(k);

    rows.push({
      id,
      name,
      corridor,
      hasCheck: !!hit,
      hora: hit?.hora || null,
      horaSec: hit?.horaSec ?? Number.MAX_SAFE_INTEGER,
    });
  }

  // 4) Ordenação e numeração da ordem por corredor
  rows.sort((a, b) =>
    (a.corridor || "").localeCompare(b.corridor || "", "pt-BR") ||
    (a.hasCheck === b.hasCheck ? 0 : a.hasCheck ? -1 : 1) ||
    (a.horaSec - b.horaSec) ||
    (a.name || "").localeCompare(b.name || "", "pt-BR")
  );

  let lastCor = null, count = 0;
  for (const r of rows) {
    if (r.corridor !== lastCor) { lastCor = r.corridor; count = 0; }
    r.ordem = ++count;
    delete r.horaSec;
  }

  return { ok: true, data: rows };
}

// ---------- Handler ----------
export default async function handler(req, res) {
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
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
