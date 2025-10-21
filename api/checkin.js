// api/checkin.js
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs18.x', regions: ['gru1'] }; // São Paulo

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jnubttskgcdguoroyyzy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s',

// HUB SJM
const LAT_BASE = -22.798782412241856;
const LNG_BASE = -43.3489248374091;
const HUB_ADDRESS = 'Av. Arthur Antônio Sendas, 999 - Parque Juriti, São João de Meriti - RJ, 25585-000';
const HUB_MAPS_LINK = 'https://maps.app.goo.gl/dEpz6cp8rKXLWoqj9';

const RAIO_KM = Number(process.env.RAIO_KM || 5);
const MIN_ACCURACY_OK = Number(process.env.MIN_ACCURACY_OK || 2000);

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
const normId = (v) => String(v ?? '').trim().replace(/\.0$/, '');

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    // Checagem de env obrigatória
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ ok: false, msg: 'Variáveis de ambiente ausentes (SUPABASE_URL / SUPABASE_SERVICE_KEY).' });
    }

    const { id, lat, lng, acc, deviceId, ua } = req.body || {};
    const idDriver = normId(id);

    if (!idDriver) return res.status(400).json({ ok: false, msg: 'ID não informado.' });
    if (lat == null || lng == null) return res.status(400).json({ ok: false, msg: 'Ative o GPS e tente novamente.' });
    if (acc != null && Number(acc) > MIN_ACCURACY_OK) return res.status(400).json({ ok: false, msg: 'Sinal de GPS fraco. Vá para área aberta.' });
    if (!deviceId) return res.status(400).json({ ok: false, msg: 'Dispositivo não identificado.' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1) Buscar nome do driver
    const { data: driverRow, error: drvErr } = await supabase
      .from('drivers')
      .select('nome')
      .eq('id_driver', idDriver)
      .single();

    if (drvErr || !driverRow) {
      return res.status(404).json({ ok: false, msg: 'ID não encontrado na base.' });
    }
    const nome = driverRow.nome;

    // 2) Mesma aparelho/dia (usa created_at)
    const hoje = new Date().toISOString().slice(0,10);
    const inicio = `${hoje}T00:00:00`;
    const fim    = `${hoje}T23:59:59`;

    const { data: deviceRegs, error: devErr } = await supabase
      .from('checkins')
      .select('id_driver')
      .eq('device_id', deviceId)
      .gte('created_at', inicio)
      .lte('created_at', fim)
      .limit(1);

    if (devErr) {
      return res.status(500).json({ ok: false, msg: `Falha ao validar dispositivo: ${devErr.message}` });
    }
    if (deviceRegs && deviceRegs.length) {
      const idJaUsado = String(deviceRegs[0].id_driver ?? '').trim();
      if (idJaUsado && idJaUsado !== idDriver) {
        return res.status(403).json({ ok: false, msg: `Este aparelho já realizou check-in hoje para o ID ${idJaUsado}.` });
      }
    }

    // 3) Geofence
    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = dist <= RAIO_KM + 0.2;
    const status = dentro ? 'DENTRO_RAIO' : 'FORA_RAIO';

    // 4) Inserção
    const payload = {
      id_driver: idDriver,
      driver: nome,
      lat: Number(lat),
      lng: Number(lng),
      accuracy: acc != null ? Number(acc) : null,
      dist_km: Number(dist.toFixed(6)),
      geofence_status: status,
      device_id: deviceId || null,
      ua: ua || null,
      hub_address: HUB_ADDRESS,
      hub_maps_link: HUB_MAPS_LINK
    };

    const { error: insErr } = await supabase.from('checkins').insert([payload]);
    if (insErr) {
      return res.status(500).json({ ok: false, msg: `Falha ao registrar: ${insErr.message}` });
    }

    return res.status(200).json({
      ok: dentro,
      msg: dentro ? '✅ Check-in registrado com sucesso!' : '❌ Fora do raio permitido.',
      nome,
      id: idDriver,
      debug: {
        hub_address: HUB_ADDRESS,
        hub_maps_link: HUB_MAPS_LINK,
        lat: Number(lat),
        lng: Number(lng),
        acc,
        dist_km: Number(dist.toFixed(3)),
        raio_km: RAIO_KM,
        status,
        now: new Date().toISOString()
      }
    });
  } catch (e) {
    // Garante JSON mesmo em exceptions
    return res.status(500).json({ ok: false, msg: e.message || 'Erro inesperado.' });
  }
}
