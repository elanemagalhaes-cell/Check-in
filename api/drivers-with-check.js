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

// Parser CSV simples (suporta aspas)
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
const name = headers[k] || col${k};
obj[name] = cols[k];
}
rows.push(obj);
}
}
return rows;
}

async function fetchCSV(url){
const r = await fetch(url);
if(!r.ok) throw new Error(Falha ao baixar CSV: ${r.status});
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
