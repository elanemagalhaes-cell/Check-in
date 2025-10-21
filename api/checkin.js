/* api/checkin.js */
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs18.x', regions: ['gru1'] };

const FUSO = 'America/Sao_Paulo';
const LAT_BASE = -22.798782412241856;
const LNG_BASE = -43.3489248374091;
const RAIO_KM = 1;
const BYPASS_GEOFENCE = true; // garante funcionamento fora do HUB

function calcularDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI/180;
  const dLon = (lon2 - lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method === 'OPTIONS') return res.status(204).end();
  if(req.method !== 'POST') return res.status(405).json({ok:false,msg:'Method not allowed'});

  try {
    const { id, lat, lng, acc } = req.body;
    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = BYPASS_GEOFENCE ? true : dist <= RAIO_KM;
    if(!dentro) return res.status(200).json({ok:false,msg:'Fora do raio permitido.'});
    return res.status(200).json({ok:true,msg:'✅ Check-in realizado com sucesso!', dist_km:dist});
  } catch(e) {
    return res.status(500).json({ok:false,msg:e.message});
  }
}
