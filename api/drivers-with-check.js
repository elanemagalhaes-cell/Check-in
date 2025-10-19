// pages/api/drivers-with-check.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://jnubttskgcdguoroyyzy.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpudWJ0dHNrZ2NkZ3Vvcm95eXp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDYzMzA2NywiZXhwIjoyMDc2MjA5MDY3fQ.nkuKEKDKGJ2wSorV_JOzns2boV2zAZMWmK4ZiV3-k3s';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

/** HH:MM -> minutos */
function toMins(s: string) {
  const [hh, mm] = s.split(':').map(Number)
  return hh * 60 + mm
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) Data de hoje (UTC -> se quiser forçar timezone, ajuste aqui)
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(now.getUTCDate()).padStart(2, '0')
    const todayISO = `${yyyy}-${mm}-${dd}`

    // 2) Escalados do dia (vieram do Apps Script)
    const { data: escalados, error: e1 } = await supabase
      .from('escalados_dia')
      .select('id_driver, driver, corridor')
      .eq('data', todayISO)

    if (e1) throw e1

    // 3) Check-ins de hoje (apenas dentro do raio)
    const start = `${todayISO}T00:00:00`
    const end   = `${todayISO}T23:59:59`

    const { data: checkins, error: e2 } = await supabase
      .from('checkins')
      .select('id_driver, driver, geofence_status, created_at')
      .gte('created_at', start)
      .lte('created_at', end)
      .eq('geofence_status', 'DENTRO_RAIO')

    if (e2) throw e2

    // 4) Monta set de quem já fez check-in (normaliza chave id+nome)
    const norm = (s?: string | null) => (s ?? '').toString().trim().toUpperCase()
    const onlyDigits = (s?: string | null) => norm(s).replace(/\D+/g, '')
    const key = (id: any, name: any) => `${onlyDigits(id)}||${norm(name)}`

    const done = new Set(checkins?.map(c => key(c.id_driver, c.driver)) ?? [])

    // 5) Janela “declinou”
    const DECLINE_AT = process.env.DECLINE_AT || '14:30'
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()  // UTC; ajuste se quiser TZ local
    const showDeclined = nowMins >= toMins(DECLINE_AT)

    // 6) Resposta: status por escalado
    const rows = (escalados ?? []).map(e => {
      const k = key(e.id_driver, e.driver)
      const inToday = done.has(k)
      return {
        id_driver: onlyDigits(e.id_driver),
        driver: e.driver ?? '',
        corridor: e.corridor ?? '',
        status: inToday ? 'checkin' : (showDeclined ? 'declined' : 'none'),
      }
    })

    // Ordenação (ajuste como preferir)
    rows.sort((a, b) =>
      (a.corridor || '').localeCompare(b.corridor || '') ||
      (a.driver   || '').localeCompare(b.driver   || '')
    )

    res.status(200).json({ ok: true, rows })
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err?.message || String(err) })
  }
}
