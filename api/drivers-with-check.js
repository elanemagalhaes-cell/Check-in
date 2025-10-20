// /api/drivers-with-check.js

const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const TABLE_CHECKINS = "checkins";
const TABLE_DRIVERS  = "drivers";

const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

// -------- Utils --------
const norm = (s) => (s ?? "").toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, "");
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return "";
  d = d.replace(/^0+/, "").replace(/0+$/, "");
  return d || "0";
}
function todayDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseTimeToSec(t) {
  // "13:42:32.20185" -> segundos (para ordenar)
  if (!t) return Number.MAX_SAFE_INTEGER;
  const m = String(t).match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const h = +m[1], mi = +m[2], s = +m[3], frac = +(m[4] || 0);
  return h*3600 + mi*60 + s + frac/10**m[4]?.length || 0;
}

async function supaPagedGet(path, query, selectRange = 1000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY/KEY nas envs da Vercel.");
  }
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

// Tenta múltiplos nomes de coluna e devolve sempre {id, name, corridor}
function mapDriverRow(r) {
  const id = normalizeId(r.id_driver);
  const name = norm(r.driver ?? r.driver_name ?? r.nome ?? "");
  const corridor = norm(r.corridor ?? r.corridor_cage ?? r.cage ?? "");
  return { id, name, corridor };
}

async function buildPayload() {
  const today = todayDate();

  // 1) CHECK-INS de hoje (usa coluna DATE 'data' + status DENTRO_RAIO)
  const selChk = encodeURIComponent("id_driver,driver,data,hora,geofence_status");
  const chkQ =
    `select=${selChk}` +
    `&data=eq.${encodeURIComponent(today)}` +
    `&geofence_status=eq.DENTRO_RAIO`;
  const chkRows = await supaPagedGet(TABLE_CHECKINS, chkQ);

  // guarda o MENOR horário de check-in por (id,name)
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

  // 2) TODOS os drivers
  //    Seleciona * e mapeia (suporta driver/driver_name/nome + corridor/corridor_cage/cage)
  const drivers = await supaPagedGet(TABLE_DRIVERS, `select=*`);

  // 3) Monta base e ordena
  const rows = [];
  for (const rr of drivers) {
    const { id, name, corridor } = mapDriverRow(rr);
    if (!id || !name) continue;
    const k = id.toUpperCase() + "||" + name.toUpperCase();
    const hit = earliest.get(k);
    rows.push({
      id,
      name,
      corridor,
      // check-in: quem tem 'hit' vem primeiro
      hasCheck: !!hit,
      hora: hit?.hora || null,
      horaSec: hit?.horaSec ?? Number.MAX_SAFE_INTEGER,
    });
  }

  // Ordena por corridor (A→Z), depois:
  //  - quem tem check-in primeiro (hasCheck false=1, true=0)
  //  - por hora crescente (ordem de chegada)
  //  - depois por nome
  rows.sort((a, b) =>
    (a.corridor || "").localeCompare(b.corridor || "", "pt-BR") ||
    (a.hasCheck === b.hasCheck ? 0 : a.hasCheck ? -1 : 1) ||
    (a.horaSec - b.horaSec) ||
    (a.name || "").localeCompare(b.name || "", "pt-BR")
  );

  // 4) Numera "ordem" dentro de cada corridor
  let lastCor = null, count = 0;
  for (const r of rows) {
    if (r.corridor !== lastCor) { lastCor = r.corridor; count = 0; }
    count += 1;
    r.ordem = count;
    delete r.horaSec; // não precisa no payload
  }

  return { ok: true, data: rows };
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
