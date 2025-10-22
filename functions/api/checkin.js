// functions/api/checkin.js  (versão sem @supabase/supabase-js)

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

const makeCors = (body, status = 200) =>
  new Response(JSON.stringify(body), {
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
    const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
    const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
;
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

    const headers = {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };

    // 1) Busca nome e corredor do escalado do dia
    let nome, corridor;
    {
      const url = new URL(`${SUPABASE_URL}/rest/v1/escalados_dia`);
      url.searchParams.set("select", "driver,corridor");
      url.searchParams.set("id_driver", `eq.${idDriver}`);
      url.searchParams.set("limit", "1");
      const r = await fetch(url, { headers });
      if (!r.ok) return makeCors({ ok: false, msg: "Falha ao consultar escala do dia." }, 500);
      const arr = await r.json();
      if (!arr || !arr.length) return makeCors({ ok: false, msg: "ID não encontrado na escala do dia." }, 404);
      nome = arr[0].driver;
      corridor = arr[0].corridor;
    }

    // Janela do dia (00:00–23:59)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const inicio = `${yyyy}-${mm}-${dd}T00:00:00`;
    const fim    = `${yyyy}-${mm}-${dd}T23:59:59`;

    // 2a) Mesmo device não pode registrar para outro ID no mesmo dia
    {
      const url = new URL(`${SUPABASE_URL}/rest/v1/checkins`);
      url.searchParams.set("select", "id_driver");
      url.searchParams.set("device_id", `eq.${deviceId}`);
      url.searchParams.set("created_at", `gte.${inicio}`);
      url.searchParams.append("created_at", `lte.${fim}`);
      url.searchParams.set("limit", "1");
      const r = await fetch(url, { headers });
      if (!r.ok) return makeCors({ ok: false, msg: "Falha ao validar dispositivo." }, 500);
      const arr = await r.json();
      if (arr && arr.length) {
        const idJaUsado = String(arr[0].id_driver ?? '').trim();
        if (idJaUsado && idJaUsado !== idDriver) {
          return makeCors({ ok: false, msg: `Este aparelho já realizou check-in hoje para o ID ${idJaUsado}.` }, 403);
        }
      }
    }

    // 2b) Mesmo ID não pode bater duas vezes no dia
    {
      const url = new URL(`${SUPABASE_URL}/rest/v1/checkins`);
      url.searchParams.set("select", "id");
      url.searchParams.set("id_driver", `eq.${idDriver}`);
      url.searchParams.set("created_at", `gte.${inicio}`);
      url.searchParams.append("created_at", `lte.${fim}`);
      url.searchParams.set("limit", "1");
      const r = await fetch(url, { headers });
      if (!r.ok) return makeCors({ ok: false, msg: "Falha ao validar repetição." }, 500);
      const arr = await r.json();
      if (arr && arr.length) return makeCors({ ok: false, msg: "Este ID já realizou check-in hoje." }, 403);
    }

    // 3) Geofence
    const dist = calcularDistKm(LAT_BASE, LNG_BASE, Number(lat), Number(lng));
    const dentro = dist <= (RADIUS_KM + 0.2);
    const status = dentro ? 'DENTRO_RAIO' : 'FORA_RAIO';

    // 4) Inserção no checkins
    {
      const url = `${SUPABASE_URL}/rest/v1/checkins`;
      const body = [{
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
      }];
      const r = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(body)
      });
      if (!r.ok) return makeCors({ ok: false, msg: "Falha ao registrar." }, 500);
    }

    if (!dentro) return makeCors({ ok: false, msg: "❌ Fora do raio permitido." }, 200);
    return makeCors({ ok: true, msg: "✅ Check-in registrado com sucesso!", nome, id: idDriver, corridor }, 200);

  } catch (e) {
    return makeCors({ ok: false, msg: "Erro inesperado." }, 500);
  }
};
