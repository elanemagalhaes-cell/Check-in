    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const normId = (v) => String(v ?? '').trim().replace(/\.0$/, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
      return res.status(500).json({ ok: false, msg: 'Configuração ausente.' });

    const { id, lat, lng, acc, deviceId, ua } = req.body || {};
    const idDriver = normId(id);
    if (!idDriver) return res.status(400).json({ ok: false, msg: 'ID não informado.' });
    if (lat == null || lng == null)
      return res.status(400).json({ ok: false, msg: 'Ative o GPS e tente novamente.' });
    if (acc && Number(acc) > MIN_ACCURACY_OK)
      return res.status(400).json({ ok: false, msg: 'Sinal de GPS fraco. Vá para área aberta.' });
    if (!deviceId) return res.status(400).json({ ok: false, msg: 'Dispositivo não identificado.' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: driverRow } = await supabase
      .from('drivers')
      .select('nome')
    
    if (deviceRegs && deviceRegs.length) {
      const idJaUsado = String(deviceRegs[0].id_driver ?? '').trim();
      if (idJaUsado && idJaUsado !== idDriver)
        return res.status(403).json({
          ok: false,
          msg: `Este aparelho já realizou check-in hoje para o ID ${idJaUsado}.`,
        });
    }

    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = dist <= RAIO_KM + 0.2;
    const status = dentro ? 'DENTRO_RAIO' : 'FORA_RAIO';

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
      hub_maps_link: HUB_MAPS_LINK,
    };

    const { error: insErr } = await supabase.from('checkins').insert([payload]);
    if (insErr) {
      console.error(insErr);
      return res.status(500).json({ ok: false, msg: 'Falha ao registrar.' });
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
        now: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, msg: 'Erro inesperado.' });
  }
}

