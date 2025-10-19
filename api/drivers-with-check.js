// /api/drivers-with-check.js
import { createClient } from '@supabase/supabase-js';

/**
 * 🔐 Variáveis de ambiente (defina na Vercel: Settings → Environment Variables)
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY       (chave service_role; NUNCA expor no front)
 * - CONTAINER_CSV_URL          (Google Sheets publicado: .../pub?output=csv)
 * - DECLINE_HOUR (ex.: 14)
 * - DECLINE_MINUTE (ex.: 30)
 */
const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
const CONTAINER_CSV_URL ='https://docs.google.com/spreadsheets/d/e/2PACX-1vQpgd6xlhwuAnfyn3wG-wJApgfoIUmoIfyADk1ohcV03Rd1ZM98d2FPx3NN2E6bDM0pMdf3OgRd-DGi/pub?gid=1330043296&single=true&output=csv';
const DECLINE_HOUR = Number(process.env.DECLINE_HOUR || 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE || 30);

// Cabeçalhos exatos do CSV da planilha publicada
const COL_CORRIDOR = 'Corridor/Cage';
const COL_NAME     = 'Driver name';
const COL_ID       = 'Driver ID';

// Utils
const norm = (s) => (s ?? '').toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, '');

/** Remove não-dígitos e zeros à esquerda/finais */
function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return '';
  d = d.replace(/^0+/, ''); // tira zeros à esquerda
  d = d.replace(/0+$/, ''); // tira zeros finais extras
  return d;                 // pode resultar em '' se virar tudo zero
}

const key = (id, name) => (normalizeId(id).toUpperCase() + '||' + norm(name).toUpperCase());

/** CSV parser simples (suporta aspas e vírgulas em campos) */
function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const rows = [];
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cols = [];
    let cur = '';
    let inQ = false;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        if (inQ && line[j + 1] === '"') { cur += '"'; j++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);

    if (i === 0) {
      headers = cols.map((c) => c.trim());
    } else {
      const obj = {};
      for (let k = 0; k < cols.length; k++) {
        const h = headers[k] || `col${k}`;
        obj[h] = cols[k];
      }
      rows.push(obj);
    }
  }
  return rows;
}

async function fetchCSV(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar CSV: ${r.status}`);
  const text = await r.text();
  return parseCSV(text);
}

export default async function handler(req, res) {
  // CORS básico
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Configuração do Supabase ausente. Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.');
    }
    if (!CONTAINER_CSV_URL) {
      throw new Error('CONTAINER_CSV_URL ausente (Google Sheets publicado em CSV).');
    }

    // 1) Escalados via CSV (Google Sheets publicado)
    const csvRows = await fetchCSV(CONTAINER_CSV_URL);

    const seen = new Set();
    const base = []; // [{ id, name, corridor }]
    for (const r of csvRows) {
      const corridor = norm(r[COL_CORRIDOR]);
      const nameRaw  = norm(r[COL_NAME]);
      const idRaw    = norm(r[COL_ID]);
      if (!nameRaw && !idRaw) continue;

      const id = normalizeId(idRaw);
      if (!id) continue;

      const k = key(id, nameRaw);
      if (seen.has(k)) continue;
      seen.add(k);

      base.push({ id, name: nameRaw, corridor });
    }

    // 2) Check-ins de hoje no Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dataHoje = `${yyyy}-${mm}-${dd}`;

    const { data: regs, error } = await supabase
      .from('checkins')
      .select('id_driver, driver, created_at')
      .gte('created_at', `${dataHoje}T00:00:00`)
      .lte('created_at', `${dataHoje}T23:59:59`);

    if (error) throw error;

    const ref = new Set(); // chaves de quem registrou hoje
    for (const r of (regs || [])) {
      const kid = normalizeId(r.id_driver);
      const nm  = norm(r.driver);
      if (!kid || !nm) continue;
      ref.add(key(kid, nm));
    }

    // 3) Cria saída minimal para o painel (id, name, corridor, inRef)
    const out = base.map(o => ({
      id: o.id,
      name: o.name,
      corridor: o.corridor || '',
      inRef: ref.has(key(o.id, o.name))
    }));

    // 4) Ordena por Corridor/Cage (A→Z) e depois por nome
    out.sort((a, b) =>
      (a.corridor || '').localeCompare(b.corridor || '', 'pt-BR') ||
      (a.name || '').localeCompare(b.name || '', 'pt-BR')
    );

    return res.status(200).json({
      ok: true,
      data: out,
      decline: { h: DECLINE_HOUR, m: DECLINE_MINUTE }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: e.message || 'Erro inesperado' });
  }
}
