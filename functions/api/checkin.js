import { createClient } from '@supabase/supabase-js';

/** Helpers **/
const calcularDistKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normId = (v) => String(v ?? '').trim().replace(/\.0$/, '');

const makeCors = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  }
});

export const onRequestOptions = async () => makeCors({}, 204);

export const onRequestPost = async ({ request, env }) => {
  try {
    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
    const LAT_BASE = parseFloat(env.LAT_BASE ?? "-22.798782412241856");
    const LNG_BASE = parseFloat(env.LNG_BASE ?? "-43.3489248374091");
    const RADIUS_KM = parseFloat(env.RADIUS_KM ?? "1");
    const MIN_ACCURACY_OK = parseFloat(env.MIN_ACCURACY_OK ?? "1200");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return makeCors({ ok: false, msg: "Config do servidor ausente." }, 500);
    }

    const { id, lat, lng, acc, deviceId, ua } = await request.json();
    const idDriver = normId(id);

    if (!idDriver) return makeCors({ ok: false, msg: "ID não informado." }, 400);
    if (lat == null || lng == null) return makeCors({ ok: false, msg: "Ative o GPS e tente novamente." }, 400);
    if (acc && Number(acc) > MIN_ACCURACY_OK) return makeCors({ ok: false, msg: "Sinal de GPS fraco. Vá para área aberta." }, 400);
    if (!deviceId) return makeCors({ ok: false, msg: "Dispositivo não identificado." }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1) Busca nome e corredor do driver do dia
    const { data: esc, error: escErr } = await supabase
      .from('escalados_dia')
      .select('driver, corridor')
      .eq('id_driver', idDriver)
      .limit(1)
      .maybeSingle();

    if (escErr || !esc) {
      return makeCors({ ok: false, msg: "ID não encontrado na escala do dia." }, 404);
    }
    const nome = esc.driver;
    const corridor = esc.corridor;

    // 2) Janela do dia local (00:00 - 23:59) — usando fuso de São Paulo
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const inicio = `${yyyy}-${mm}-${dd}T00:00:00`;
    const fim    = `${yyyy}-${mm}-${dd}T23:59:59`;

    // 2a) Mesmo device não pode registrar para outro ID no mesmo dia
    const { data: deviceRegs, error: devErr } = await supabase
      .from('checkins')
      .select('id_driver')
      .eq('device_id', deviceId)
      .gte('created_at', inicio)
      .lte('created_at', fim)
      .limit(1);

    if (devErr) return makeCors({ ok: false, msg: "Falha ao validar dispositivo." }, 500);

    if (deviceRegs && deviceRegs.length) {
      const idJaUsado = String(deviceRegs[0].id_driver ?? '').trim();
      if (idJaUsado && idJaUsado !== idDriver) {
        return makeCors({ ok: false, msg: `Este aparelho já realizou check-in hoje para o ID ${idJaUsado}.` }, 403);
      }
    }

    // 2b) Mesmo ID não pode bater duas vezes
    const { data: repet, error: repErr } = await supabase
      .from('checkins')
      .select('id')
      .eq('id_driver', idDriver)
      .gte('created_at', inicio)
      .lte('created_at', fim)
      .limit(1);

    if (repErr) return makeCors({ ok: false, msg: "Falha ao validar repetição." }, 500);
    if (repet && repet.length) return makeCors({ ok: false, msg: "Este ID já realizou check-in hoje." }, 403);

    // 3) Geofence
    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = dist <= (RADIUS_KM + 0.2); // tolerância opcional
    const status = dentro ? 'DENTRO_RAIO' : 'FORA_RAIO';

    // 4) Inserção
    const { error: insErr } = await supabase.from('checkins').insert([{
      id_driver: idDriver,
      driver: nome,
      corridor,
      lat: Number(lat),
      lng: Number(lng),
      accuracy: acc != null ? Number(acc) : null,
      dist_km: dist,
      geofence_status: status,
      device_id: deviceId || null,
      ua: ua || null
    }]);

    if (insErr) return makeCors({ ok: false, msg: "Falha ao registrar." }, 500);

    if (!dentro) return makeCors({ ok: false, msg: "❌ Fora do raio permitido." }, 200);
    return makeCors({ ok: true, msg: "✅ Check-in registrado com sucesso!", nome, id: idDriver, corridor }, 200);
  } catch (e) {
    return makeCors({ ok: false, msg: "Erro inesperado." }, 500);
  }
};
