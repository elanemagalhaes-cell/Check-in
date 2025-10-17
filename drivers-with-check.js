import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONTAINER_CSV_URL = process.env.CONTAINER_CSV_URL || '';
const DECLINE_HOUR = Number(process.env.DECLINE_HOUR || 14);
const DECLINE_MINUTE = Number(process.env.DECLINE_MINUTE || 30);

// Cabeçalhos exatos do CSV (colunas C, F, G)
const COL_CORRIDOR = 'Corridor/Cage';
const COL_NAME = 'Driver name';
const COL_ID = 'Driver ID';

const norm = (s) => (s ?? '').toString().trim();
const onlyDigits = (s) => norm(s).replace(/\D+/g, '');
function normalizeId(id){
  let d = onlyDigits(id);
  if(!d) return '';
  d = d.replace(/0+$/, ''); // zeros finais
  d = d.replace(/^0+/, ''); // zeros iniciais
  return d || '0';
}
const key = (id, name) => (normalizeId(id).toUpperCase() + '||' + norm(name).toUpperCase());

// Parser CSV simples (suporta aspas e vírgula)
function parseCSV(csv){
  const lines = csv.split(/\r?\n/).filter(l => l.length);
  if(lines.length === 0) return [];
  const rows = [];
  let headers = [];
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    const cols = [];
    let cur = '', inQ = false;
    for(let j=0;j<line.length;j++){
      const ch = line[j];
      if(ch === '"'){
        if(inQ && line[j+1] === '"'){ cur += '"'; j++; }
        else inQ = !inQ;
      }else if(ch === ',' && !inQ){
        cols.push(cur); cur = '';
      }else{
        cur += ch;
      }
    }
    cols.push(cur);
    if(i === 0){
      headers = cols.map(c => c.trim());
    }else{
      const obj = {};
      for(let k=0;k<cols.length;k++){
        const hname = headers[k] || `col${k}`;
        obj[hname] = cols[k];
      }
      rows.push(obj);
    }
  }
  return rows;
}

async function fetchCSV(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`Falha ao baixar CSV: ${r.status}`);
  const text = await r.text();
  return parseCSV(text);
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(204).end();
  if(req.method !== 'GET') return res.status(405).json({ ok:false, msg:'Method not allowed' });

  try{
    if(!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Config do servidor ausente.');
    if(!CONTAINER_CSV_URL) throw new Error('CONTAINER_CSV_URL ausente.');

    const csvRows = await fetchCSV(CONTAINER_CSV_URL);

    const seen = new Set();
    const base = [];
    for(const r of csvRows){
      const corridor = norm(r[COL_CORRIDOR]);
      const nameRaw  = norm(r[COL_NAME]);
      const idRaw    = norm(r[COL_ID]);
      if(!nameRaw && !idRaw) continue;

      const id = normalizeId(idRaw);
      const name = nameRaw;
      if(!id || id === '0') continue;

      const k = key(id, name);
      if(seen.has(k)) continue;
      seen.add(k);

      base.push({ id, name, corridor });
    }

    base.sort((a,b) =>
      (a.id||'').localeCompare(b.id||'') ||
      (a.name||'').localeCompare(b.name||'')
    );

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const dd = String(now.getDate()).padStart(2,'0');
    const dataHoje = `${yyyy}-${mm}-${dd}`;

    const { data: regs, error } = await supabase
      .from('checkins')
      .select('id_driver, driver, created_at')
      .gte('created_at', `${dataHoje}T00:00:00`)
      .lte('created_at', `${dataHoje}T23:59:59`);

    if(error) throw error;

    const ref = new Set();
    for(const r of (regs || [])){
      const kid = normalizeId(r.id_driver);
      ref.add(key(kid, r.driver));
    }

    const out = base.map(o => ({
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

  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, msg: e.message || 'Erro inesperado' });
  }
}
