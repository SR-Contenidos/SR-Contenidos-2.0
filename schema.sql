-- SR Contenidos 2.0
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Usa tablas propias sr20_* para no romper la aplicación anterior.

create extension if not exists pgcrypto;

do $$ begin
  create type public.sr20_role as enum ('admin','client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sr20_client_status as enum ('Activo','Pausado','Finalizado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sr20_reel_status as enum ('Idea','Para grabar','Grabado','Editando','Listo','Enviado al cliente','Publicado');
exception when duplicate_object then null; end $$;

create table if not exists public.sr20_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null default '',
  phone text not null default '',
  instagram text not null default '',
  category text not null default '',
  rubric text not null default '',
  plan integer not null default 4,
  status public.sr20_client_status not null default 'Activo',
  notes text not null default '',
  plan_price numeric(14,2) not null default 0,
  color text not null default '#0ea5e9',
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role public.sr20_role not null default 'client',
  client_id uuid references public.sr20_clients(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  reels integer not null default 4 check (reels >= 0),
  gift_reels integer not null default 0 check (gift_reels >= 0),
  price numeric(14,2) not null default 0,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_reels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sr20_clients(id) on delete cascade,
  title text not null,
  format text not null default '',
  status public.sr20_reel_status not null default 'Idea',
  published timestamptz null,
  approval_status text not null default 'Pendiente' check (approval_status in ('Pendiente','Aprobado','Cambios solicitados')),
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sr20_clients(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_calendar_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sr20_clients(id) on delete cascade,
  title text not null,
  type text not null default 'Grabación',
  start_at timestamptz not null,
  end_at timestamptz null,
  price numeric(14,2) not null default 0,
  payment_status text not null default 'No corresponde',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_stats (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.sr20_reels(id) on delete cascade,
  label text not null,
  hours integer not null default 0,
  views bigint not null default 0,
  likes bigint not null default 0,
  saves bigint not null default 0,
  shares bigint not null default 0,
  reposts bigint not null default 0,
  source_image_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sr20_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.sr20_clients(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists sr20_profiles_client_idx on public.sr20_profiles(client_id);
create index if not exists sr20_reels_client_idx on public.sr20_reels(client_id);
create index if not exists sr20_stats_reel_idx on public.sr20_stats(reel_id);
create index if not exists sr20_payments_client_idx on public.sr20_payments(client_id);
create index if not exists sr20_events_client_idx on public.sr20_calendar_events(client_id);
create index if not exists sr20_messages_client_idx on public.sr20_messages(client_id);

create or replace function public.sr20_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.sr20_profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create or replace function public.sr20_my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.sr20_profiles where id = auth.uid();
$$;

create or replace function public.sr20_can_see_client(target_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.sr20_is_admin() or target_client = public.sr20_my_client_id();
$$;

create or replace function public.sr20_set_reel_approval(target_reel uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if new_status not in ('Pendiente','Aprobado','Cambios solicitados') then
    raise exception 'Estado de aprobación inválido';
  end if;
  update public.sr20_reels r
     set approval_status = new_status
   where r.id = target_reel
     and r.client_id = public.sr20_my_client_id();
  if not found then raise exception 'Reel no encontrado o acceso denegado'; end if;
end;
$$;

create or replace function public.sr20_mark_message_read(target_message uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.sr20_messages m
     set read_at = now()
   where m.id = target_message
     and public.sr20_can_see_client(m.client_id);
  if not found then raise exception 'Mensaje no encontrado o acceso denegado'; end if;
end;
$$;

grant execute on function public.sr20_is_admin() to authenticated;
grant execute on function public.sr20_my_client_id() to authenticated;
grant execute on function public.sr20_can_see_client(uuid) to authenticated;
grant execute on function public.sr20_set_reel_approval(uuid,text) to authenticated;
grant execute on function public.sr20_mark_message_read(uuid) to authenticated;

alter table public.sr20_clients enable row level security;
alter table public.sr20_profiles enable row level security;
alter table public.sr20_plans enable row level security;
alter table public.sr20_reels enable row level security;
alter table public.sr20_payments enable row level security;
alter table public.sr20_calendar_events enable row level security;
alter table public.sr20_stats enable row level security;
alter table public.sr20_messages enable row level security;

-- Limpieza idempotente de policies
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename like 'sr20_%' LOOP
    EXECUTE format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

create policy sr20_clients_select on public.sr20_clients for select to authenticated using (public.sr20_can_see_client(id));
create policy sr20_clients_admin_insert on public.sr20_clients for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_clients_admin_update on public.sr20_clients for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_clients_admin_delete on public.sr20_clients for delete to authenticated using (public.sr20_is_admin());

create policy sr20_profiles_select_self on public.sr20_profiles for select to authenticated using (id = auth.uid() or public.sr20_is_admin());
create policy sr20_profiles_admin_all on public.sr20_profiles for all to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());

create policy sr20_plans_select on public.sr20_plans for select to authenticated using (true);
create policy sr20_plans_admin_insert on public.sr20_plans for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_plans_admin_update on public.sr20_plans for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_plans_admin_delete on public.sr20_plans for delete to authenticated using (public.sr20_is_admin());

create policy sr20_reels_select on public.sr20_reels for select to authenticated using (public.sr20_can_see_client(client_id));
create policy sr20_reels_admin_insert on public.sr20_reels for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_reels_admin_update on public.sr20_reels for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_reels_admin_delete on public.sr20_reels for delete to authenticated using (public.sr20_is_admin());

create policy sr20_payments_select on public.sr20_payments for select to authenticated using (public.sr20_can_see_client(client_id));
create policy sr20_payments_admin_insert on public.sr20_payments for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_payments_admin_update on public.sr20_payments for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_payments_admin_delete on public.sr20_payments for delete to authenticated using (public.sr20_is_admin());

create policy sr20_events_select on public.sr20_calendar_events for select to authenticated using (public.sr20_can_see_client(client_id));
create policy sr20_events_admin_insert on public.sr20_calendar_events for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_events_admin_update on public.sr20_calendar_events for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_events_admin_delete on public.sr20_calendar_events for delete to authenticated using (public.sr20_is_admin());

create policy sr20_stats_select on public.sr20_stats for select to authenticated using (exists(select 1 from public.sr20_reels r where r.id = reel_id and public.sr20_can_see_client(r.client_id)));
create policy sr20_stats_admin_insert on public.sr20_stats for insert to authenticated with check (public.sr20_is_admin());
create policy sr20_stats_admin_update on public.sr20_stats for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());
create policy sr20_stats_admin_delete on public.sr20_stats for delete to authenticated using (public.sr20_is_admin());

create policy sr20_messages_select on public.sr20_messages for select to authenticated using (public.sr20_can_see_client(client_id));
create policy sr20_messages_insert on public.sr20_messages for insert to authenticated with check (
  sender_user_id = auth.uid() and public.sr20_can_see_client(client_id)
);
create policy sr20_messages_admin_update on public.sr20_messages for update to authenticated using (public.sr20_is_admin()) with check (public.sr20_is_admin());

insert into public.sr20_plans(name,reels,gift_reels,price,description,active,sort_order)
select 'Pack 3 + 1 de regalo',3,1,110000,'3 videos + 1 video de regalo',true,1
where not exists (select 1 from public.sr20_plans);
insert into public.sr20_plans(name,reels,gift_reels,price,description,active,sort_order)
select 'Pack 4 videos',4,0,110000,'4 videos',true,2
where not exists (select 1 from public.sr20_plans where reels=4 and gift_reels=0);
insert into public.sr20_plans(name,reels,gift_reels,price,description,active,sort_order)
select 'Pack 8 videos',8,0,220000,'8 videos',true,3
where not exists (select 1 from public.sr20_plans where reels=8 and gift_reels=0);
