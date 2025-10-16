import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const FUSO = 'America/Sao_Paulo';
const LAT_BASE = -22.798782412241856;
const LNG_BASE = -43.3489248374091;
const RAIO_KM  = 2;          // km
const MIN_ACCURACY_OK = 1200; // metros

function calcularDistKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
const normId = v => String(v||'').trim().replace(/\.0$/,'');

export default async function handler(req, res){
  if (req.method === 'OPTIONS'){
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST'){
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ ok:false, msg:'Method not allowed' });
  }

  try{
    const { id, lat, lng, acc, deviceId, ua } = req.body || {};
    const idDriver = normId(id);

    if(!SUPABASE_URL || !SUPABASE_SERVICE_KEY){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ ok:false, msg:'Config do servidor ausente.' });
    }

    if(!idDriver){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ ok:false, msg:'ID não informado.' });
    }
    if(lat == null || lng == null){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ ok:false, msg:'Ative o GPS e tente novamente.' });
    }
    if(acc && Number(acc) > MIN_ACCURACY_OK){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json({ ok:false, msg:'Sinal de GPS fraco. Vá para área aberta.' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // consulta driver
    const { data: driverRow, error: drvErr } = await supabase
      .from('drivers')
      .select('nome')
      .eq('id_driver', idDriver)
      .single();

    if (drvErr || !driverRow){
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(404).json({ ok:false, msg:'ID não encontrado na base.' });
    }

    const nome = driverRow.nome;

    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = dist <= RAIO_KM + 0.2;
    const status = dentro ? 'DENTRO_RAIO' : 'FORA_RAIO';

    const { error: insErr } = await supabase.from('checkins').insert([{
      id_driver: idDriver,
      driver: nome,
      lat: Number(lat),
      lng: Number(lng),
      accuracy: acc != null ? Number(acc) : null,
      dist_km: dist,
      geofence_status: status,
      device_id: deviceId || null,
      ua: ua || null
    }]);

    if (insErr){
      console.error(insErr);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(500).json({ ok:false, msg:'Falha ao registrar.' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!dentro) return res.status(200).json({ ok:false, msg:'❌ Fora do raio permitido.' });
    return res.status(200).json({ ok:true, msg:'✅ Check-in registrado com sucesso!', nome, id:idDriver });

  } catch (e){
    console.error(e);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ ok:false, msg:'Erro inesperado.' });
  }
}
