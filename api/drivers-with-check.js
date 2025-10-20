// /api/drivers-with-check.js

// ======= CONFIG via env =======
const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
 
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const VIEW_PAINEL = process.env.VIEW_PAINEL || "v_painel_drivers";

// Cache anti-martelo
const CACHE_TTL_MS = 20_000;
let cache = { at: 0, key: "", payload: null };

// ======= helpers =======
const norm = (s) => (s ?? "").toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, "");
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return "";
  d = d.replace(/^0+|0+$/g, "");
  return d || "0";
}
function corridorLetter(corr) {
  const m = String(corr || "").match(/^([A-Za-zÁ-Ú]+)/);
  return m ? m[1].toUpperCase() : "";
}

async function supaPagedGet(path, query, selectRange = 2000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Defina SUPABASE_URL e SUPABASE_SERVICE_KEY (ou SERVICE_ROLE_KEY) no Vercel."
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
      // evita conexões penduradas sob burst
      keepalive: true,
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

function makeMessage(row) {
  if (!row) return "";
  if (!row.has_check) {
    return `${row.driver} — ${row.corridor || "-"} • ainda não fez check-in hoje.`;
  }
  const letra = corridorLetter(row.corridor);
  return `${row.driver} — ${row.corridor} • ${row.ordem}º lugar${
    letra ? ` (letra ${letra})` : ""
  }`;
}

async function buildPayload(idFilter) {
  // monta query SELECT
  const select = encodeURIComponent(
    "id_driver,driver,corridor,has_check,hora,ordem"
  );

  let query = `select=${select}`;
  if (idFilter) {
    query += `&id_driver=eq.${encodeURIComponent(idFilter)}`;
  }

  // Ordenação (segurança — muitos clientes não mandam order na view)
  query += `&order=corridor.asc&order=ordem.asc&order=driver.asc`;

  // Busca
  const rows = await supaPagedGet(VIEW_PAINEL, query);

  // Se não for filtro por ID, podemos ordenar novamente por segurança
  if (!idFilter) {
    rows.sort(
      (a, b) =>
        (a.corridor || "").localeCompare(b.corridor || "", "pt-BR") ||
        (a.ordem ?? 0) - (b.ordem ?? 0) ||
        (a.driver || "").localeCompare(b.driver || "", "pt-BR")
    );
  }

  // Se veio com ?id=, devolve também resumo do “meu lugar na fila”
  let me = null;
  let message = "";
  if (idFilter) {
    me = rows.find((r) => norm(r.id_driver) === idFilter) || null;
    message = me ? makeMessage(me) : "ID não encontrado na escala de hoje.";
  }

  return {
    ok: true,
    data: rows,
    ...(idFilter ? { me, message } : {}),
  };
}

// ======= handler =======
export default async function handler(req, res) {
  // CORS / preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const idParam = normalizeId(req.query?.id || "");
    const debug = String(req.query?.debug || "0") === "1";

    // cache por chave (id ou lista)
    const cacheKey = idParam ? `id:${idParam}` : "all";
    const now = Date.now();
    if (!debug && cache.payload && cache.key === cacheKey && now - cache.at < CACHE_TTL_MS) {
      return res.status(200).json(cache.payload);
    }

    const payload = await buildPayload(idParam || null);
    cache = { at: now, key: cacheKey, payload };
    return res.status(200).json(payload);
  } catch (err) {
    const msg = (err && (err.message || err.toString())) || "unknown";
    return res.status(500).json({ ok: false, error: msg });
  }
}
