const SUPABASE_URL =
  'https://jnubttskgcdguoroyyzy.supabase.co';

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';

 
const T_ESCALADOS = "escalados_dia";
const T_CHECKINS  = "checkins";
const CACHE_TTL_MS = 20_000;
let cache = { at: 0, payload: null };

const norm = (s)=> (s??"").toString().trim();
const onlyDigits = (s)=> norm(s).replace(/\D+/g,"");
function normalizeId(id){ let d=onlyDigits(id); if(!d) return ""; d=d.replace(/^0+|0+$/g,""); return d||"0"; }
function parseTimeToSec(t){
  if(!t) return Number.MAX_SAFE_INTEGER;
  const m=String(t).match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if(!m) return Number.MAX_SAFE_INTEGER;
  const [_,H,M,S,F]=m; return +H*3600 + +M*60 + +S + (F? +F/10**F.length:0);
}
async function supaPagedGet(table, query, pageSize=2000){
  const base = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${query}`;
  let start=0, all=[];
  while(true){
    const end = start+pageSize-1;
    const r = await fetch(base, {
      headers:{
        apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`,
        "Accept-Profile":"public","Range-Unit":"items", Range:`${start}-${end}`
      }, keepalive:true
    });
    const txt = await r.text();
    if(!r.ok) throw new Error(`Supabase ${table} (${r.status}): ${txt}`);
    const batch = JSON.parse(txt||"[]"); all.push(...batch);
    if(batch.length<pageSize) break; start+=pageSize;
  }
  return all;
}
async function buildPayload(){
  // 1) escalados_dia -> base + corredor
  const selEsc = encodeURIComponent("id_driver,driver,corridor");
  const esc = await supaPagedGet(T_ESCALADOS, `select=${selEsc}`);
  const byId = new Map();
  for(const r of esc){
    const id=normalizeId(r.id_driver), name=norm(r.driver), cor=norm(r.corridor);
    if(!id||!name) continue;
    if(!byId.has(id)) byId.set(id,{id,name,corridor:cor});
  }

  // 2) checkins -> primeira hora por id (DENTRO_RAIO)
  const selChk = encodeURIComponent("id_driver,hora,geofence_status");
  const chk = await supaPagedGet(T_CHECKINS, `select=${selChk}&geofence_status=eq.DENTRO_RAIO`);
  const earliest = new Map();
  for(const r of chk){
    const id=normalizeId(r.id_driver), s=parseTimeToSec(r.hora);
    const prev=earliest.get(id); if(!prev||s<prev.horaSec) earliest.set(id,{hora:r.hora,horaSec:s});
  }

  // 3) monta linhas (só quem está em escalados_dia entra)
  const rows=[];
  for(const [id,info] of byId.entries()){
    const hit=earliest.get(id);
    rows.push({ id, name:info.name, corridor:info.corridor,
      hasCheck:!!hit, hora:hit?.hora||null, horaSec:hit?.horaSec??Number.MAX_SAFE_INTEGER });
  }

  // 4) ordena e numera por corredor
  rows.sort((a,b)=>
    (a.corridor||"").localeCompare(b.corridor||"","pt-BR") ||
    (a.hasCheck===b.hasCheck?0:(a.hasCheck?-1:1)) ||
    (a.horaSec-b.horaSec) ||
    (a.name||"").localeCompare(b.name||"","pt-BR")
  );
  let last=null,c=0;
  for(const r of rows){ if(r.corridor!==last){last=r.corridor;c=0;} r.ordem=++c; delete r.horaSec; }
  return { ok:true, data:rows };
}

export default async function handler(req,res){
  if(req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Content-Type","application/json; charset=utf-8");
  const debug = String(req.query?.debug||"0")==="1";
  try{
    const now=Date.now();
    if(!debug && cache.payload && now-cache.at<CACHE_TTL_MS){
      return res.status(200).json(cache.payload);
    }
    const payload = await buildPayload();
    cache = { at: Date.now(), payload };
    return res.status(200).json(payload);
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || String(err) });
  }
}
