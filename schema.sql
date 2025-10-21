-- Estrutura de tabelas Supabase
create table if not exists public.drivers (
  id serial primary key,
  id_driver text unique not null,
  nome text,
  device_id text,
  data date,
  hora time,
  status text
);

create table if not exists public.checkins (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  id_driver text not null,
  lat double precision,
  lng double precision,
  accuracy double precision,
  dist_km double precision,
  status text
);
