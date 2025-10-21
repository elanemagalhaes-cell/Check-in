# Check-in HUB — Cloudflare Pages + Supabase

Stack:
- **Frontend**: `public/index.html` (HTML + JS)
- **Backend**: Cloudflare Pages Functions (`functions/api/checkin.js` e `functions/api/ping.js`)
- **DB**: Supabase (Postgres). Tabelas: `escalados_dia` (consulta) e `checkins` (registro).

## Variáveis de Ambiente (Cloudflare Pages → Settings → Environment Variables)
Crie as seguintes variáveis:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (chave *service role* — mantenha privada)
- `LAT_BASE` (ex: -22.798782412241856)
- `LNG_BASE` (ex: -43.3489248374091)
- `RADIUS_KM` (ex: 1) — raio máximo permitido
- `MIN_ACCURACY_OK` (ex: 1200) — precisão máxima (em metros)

## Deploy (via GitHub)
1. Suba este repositório para o GitHub.
2. No Cloudflare, crie um projeto **Pages** conectado ao seu repositório.
3. Build command: *vazio* (não precisa). Output directory: `public`.
4. Em **Functions**, deixe o diretório padrão `functions`.
5. Configure as **Environment Variables** acima.
6. Aguarde o deploy e abra `/` (frontend) e `/api/ping` (diagnóstico).

## Fluxo de negócio
- Usuário insere **Driver ID**.
- Frontend coleta **GPS** e monta payload com `deviceId` (persistido em `localStorage`), `ua` e `accuracy`.
- Backend valida:
  - ID existe em `public.escalados_dia` (retorna `driver` e `corridor`).
  - Geofence: distância <= `RADIUS_KM` (com pequena folga de 0.2km).
  - **Mesmo device** não pode registrar para **outro ID** no mesmo dia.
  - **Mesmo ID** não pode registrar **duas vezes** no mesmo dia.
  - `accuracy <= MIN_ACCURACY_OK`.
- Insere registro em `public.checkins` com os campos solicitados.

## Estrutura das tabelas esperadas
### public.escalados_dia
- id_driver (text)
- driver (text)
- corridor (text)
- data (date)
- created_at (timestamptz, default now())

### public.checkins
- id (serial/bigint) PK
- created_at (timestamptz, default now())
- id_driver (text)
- driver (text)
- corridor (text)
- lat (float8)
- lng (float8)
- accuracy (float8)
- dist_km (float8)
- geofence_status (text)
- device_id (text)
- ua (text)
## Testes rápidos
- Acesse `/` no celular, permita o GPS e faça 1 check-in dentro do raio. 
- Repita com o **mesmo device** para outro ID → deve bloquear.
- Repita com o **mesmo ID** no mesmo dia → deve bloquear.
- Bata fora do raio (> 1km) → deve recusar.

