// api/checkin.js
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs18.x', regions: ['gru1'] };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const LAT_BASE = -22.798782412241856;
const LNG_BASE = -43.3489248374091;
const RAIO_KM = 5;
const MIN_ACCURACY_OK = 2000;

function calcularDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, msg:'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ ok:false, msg:'Variáveis de ambiente ausentes' });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { id, lat, lng, acc, deviceId, ua } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, msg:'ID ausente' });

    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const status = dist <= RAIO_KM ? 'DENTRO_RAIO' : 'FORA_RAIO';

    const { error } = await supabase.from('checkins').insert([{
      id_driver:id, lat, lng, accuracy:acc, device_id:deviceId, ua, dist_km:dist, geofence_status:status
    }]);

    if (error) throw error;
    return res.status(200).json({ ok:true, msg:'Check-in registrado', debug:{ dist_km:dist, status } });
  } catch (e) {
    return res.status(500).json({ ok:false, msg:e.message || 'Erro inesperado' });
  }
}
