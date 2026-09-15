-- SmartTrap dashboard: per-account data access (row-level security)
--
-- Each dashboard login sees only its own trap nodes, their readings, its orchard
-- boundary, and its rover track. Until this runs, anyone with the publishable key
-- (it's in the public website code) can read these tables through the API.
--
-- How ownership works
--   node_locations, orchard_boundaries, rover_location: an owner_id column. The
--   dashboard doesn't send it; the database fills in the signed-in user.
--   trap_data: no owner column. A reading is visible to the account that
--   registered its node_id in node_locations (scan.html), so the Raspberry Pi
--   keeps uploading exactly as it does today.
--
-- Before running
--   1. The Raspberry Pi sync script must upload with a SECRET key (sb_secret_…
--      or the service_role key), which skips these rules. After this runs, the
--      publishable key can't read or write these tables. Create a secret key
--      under Project Settings → API Keys. Records still land in the Pi's local
--      CSV, so nothing is lost while uploads fail.
--   2. Replace FIELD_ACCOUNT_EMAIL below with the login that owns your existing
--      traps and orchard boundary.
--
-- Then paste this whole file into the SQL Editor and click Run. Safe to re-run.

-- ── 1. Owner columns; existing rows go to the field account ──
do $$
declare
  field_email constant text := 'FIELD_ACCOUNT_EMAIL';  -- ← your field login's email
  field_id uuid;
begin
  select id into field_id from auth.users where lower(email) = lower(field_email);
  if field_id is null then
    raise exception 'No dashboard login uses "%". Put the field login''s email near the top of this file.', field_email;
  end if;

  alter table public.node_locations     add column if not exists owner_id uuid references auth.users (id) on delete cascade;
  alter table public.orchard_boundaries add column if not exists owner_id uuid references auth.users (id) on delete cascade;
  alter table public.rover_location     add column if not exists owner_id uuid references auth.users (id) on delete cascade;

  update public.node_locations     set owner_id = field_id where owner_id is null;
  update public.orchard_boundaries set owner_id = field_id where owner_id is null;
  update public.rover_location     set owner_id = field_id where owner_id is null;
end $$;

-- New nodes and boundaries get the signed-in user (scan.html, detail.html, orchard-setup.html).
alter table public.node_locations
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;
alter table public.orchard_boundaries
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;
-- No default: the rover GPS logger isn't signed in, so it must send owner_id itself.
alter table public.rover_location
  alter column owner_id set not null;

-- ── 2. Indexes for the access checks and the dashboard's queries ──
create index if not exists node_locations_owner_id_idx     on public.node_locations (owner_id);
create index if not exists orchard_boundaries_owner_id_idx on public.orchard_boundaries (owner_id);
create index if not exists rover_location_owner_id_idx     on public.rover_location (owner_id, id);
create index if not exists trap_data_node_id_upload_idx    on public.trap_data (node_id, upload_timestamp);

-- ── 3. Turn on RLS and remove every existing policy ─────────
-- Policies add up (they're OR'd), so one leftover "public" or "anon" policy
-- would keep the data open. Only the policies below remain.
alter table public.trap_data          enable row level security;
alter table public.node_locations     enable row level security;
alter table public.rover_location     enable row level security;
alter table public.orchard_boundaries enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('trap_data', 'node_locations', 'rover_location', 'orchard_boundaries')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ── 4. Signed-in users: their own rows only ─────────────────
-- node_locations: list (all pages), register (scan.html), edit + remove (detail.html)
create policy "Own nodes: read" on public.node_locations
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Own nodes: add" on public.node_locations
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Own nodes: edit" on public.node_locations
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Own nodes: remove" on public.node_locations
  for delete to authenticated using (owner_id = (select auth.uid()));

-- trap_data: readings from your registered nodes; "Clear Node Data" (detail.html)
create policy "Own nodes' readings: read" on public.trap_data
  for select to authenticated
  using (node_id in (select node_id from public.node_locations where owner_id = (select auth.uid())));
create policy "Own nodes' readings: delete" on public.trap_data
  for delete to authenticated
  using (node_id in (select node_id from public.node_locations where owner_id = (select auth.uid())));

-- orchard_boundaries: heatmap clipping (index.html), draw + save (orchard-setup.html)
create policy "Own boundaries: read" on public.orchard_boundaries
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Own boundaries: add" on public.orchard_boundaries
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Own boundaries: edit" on public.orchard_boundaries
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- rover_location: read only from the dashboard
create policy "Own rover track: read" on public.rover_location
  for select to authenticated using (owner_id = (select auth.uid()));

-- ── 5. Field devices ────────────────────────────────────────
-- No policies for the publishable (anon) key. The Pi sync script and the rover
-- GPS logger should use a secret key. When the rover logger runs again, it must
-- also send owner_id: the field login's user ID from Authentication → Users.
--
-- Stopgap only, if the Pi can't switch keys yet. Anyone with the publishable key
-- could then add fake readings, and uploads that ask for the inserted rows back
-- still fail because anon can't read them.
-- create policy "Devices: upload readings" on public.trap_data
--   for insert to anon with check (true);

-- ── Result: which login owns what ───────────────────────────
select u.email,
       (select count(*) from public.node_locations     n where n.owner_id = u.id) as nodes,
       (select count(*) from public.orchard_boundaries b where b.owner_id = u.id) as orchard_boundaries
from auth.users u
order by u.email;
