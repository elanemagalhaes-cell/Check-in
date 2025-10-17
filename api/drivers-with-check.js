// api/drivers-with-check.js
import { createClient } from '@supabase/supabase-js';

// 🔐 Variáveis de ambiente
const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
const CONTAINER_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQpgd6xlhwuAnfyn3wG-wJApgfoIUmoIfyADk1ohcV03Rd1ZM98d2FPx3NN2E6bDM0pMdf3OgRd-DGi/pub?output=csv'; || ''; // link CSV (Google Sheets export)
const DECLINE_HOUR = Number(process.env.DECLINE_HOUR || 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE || 30);

// Cabeçalhos exatos do CSV (colunas C, F, G)
const COL_CORRIDOR = 'Corridor/Cage';
const COL_NAME = 'Driver name';
const COL_ID = 'Driver ID';

const norm = (s) => (s ?? '').toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, '');

function normalizeId(id) {
  let d = onlyDigits(id);
  if (!d) return '';
  d = d.replace(/0+$/, ''); // zeros finais
  d = d.replace(/^0+/, ''); // zeros iniciais
  return d || '0';
}

const key = (id, name) => (normalizeId(id).toUpperCase() + '||' + norm(name).toUpperCase());

// CSV parser simples com suporte a aspas
function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.length);
  if (lines.length === 0) return [];
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
        if (inQ && line[j + 1] === '"') {
          cur += '"'; j++;
        } else {
          inQ = !inQ;
        }
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
        const hname = headers[k] || `col${k}`;
        obj[hname] = cols[k];
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Config do servidor ausente.');
    if (!CONTAINER_CSV_URL) throw new Error('CONTAINER_CSV_URL ausente.');

    // 1) Lê Escalados (CSV)
    const csvRows = await fetchCSV(CONTAINER_CSV_URL);

    const seen = new Set();
    const base = [];
    for (const r of csvRows) {
      const corridor = norm(r[COL_CORRIDOR]);
      const nameRaw  = norm(r[COL_NAME]);
      const idRaw    = norm(r[COL_ID]);
      if (!nameRaw && !idRaw) continue;

      const id = normalizeId(idRaw);
      const name = nameRaw;
      if (!id || id === '0') continue;

      const k = key(id, name);
      if (seen.has(k)) continue;
      seen.add(k);

      base.push({ id, name, corridor });
    }
    base.sort((a, b) =>
      (a.id || '').localeCompare(b.id || '') ||
      (a.name || '').localeCompare(b.name || '')
    );

    // 2) Busca check-ins de hoje
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

    const ref = new Set();
    for (const r of (regs || [])) {
      const kid = normalizeId(r.id_driver);
      ref.add(key(kid, r.driver));
    }

    // 3) Junta e responde
    const out = base.map((o) => ({
      id: o.id,
      name: o.name,
      corridor: o.corridor || '',
      inRef: ref.has(key(o.id, o.name))
    }));

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
