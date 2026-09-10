-- SmartTrap dashboard: row-level security (RLS)
--
-- Without this, the dashboard login only hides the pages. Anyone with the
-- publishable key can still read and write the tables through the REST API.
--
-- Run in the Supabase SQL Editor ONLY AFTER:
--   1. At least one invited user can sign in to /dashboard/.
--   2. You've checked which key the Raspberry Pi sync script (writes trap_data)
--      and the rover GPS logger (writes rover_location) use. If they use the
--      publishable/anon key, either switch them to the secret (service_role)
--      key, which ignores RLS and is fine on devices you control, or uncomment
--      the device policies at the bottom. That includes any SELECT or upsert
--      the scripts do.
--   3. You've opened Authentication → Policies and deleted any existing policy
--      that grants access to "public" or "anon". Policies add up (they're OR'd),
--      so one leftover open policy keeps the data readable without logging in.

-- ── Turn on RLS ─────────────────────────────────────────────
alter table public.trap_data          enable row level security;
alter table public.node_locations     enable row level security;
alter table public.rover_location     enable row level security;
alter table public.orchard_boundaries enable row level security;

-- ── trap_data: read (all pages), clear a node's data (detail.html) ──
create policy "Signed-in users can read trap data"
  on public.trap_data for select to authenticated using (true);
create policy "Signed-in users can delete trap data"
  on public.trap_data for delete to authenticated using (true);

-- ── node_locations: read, register (scan.html), edit + remove (detail.html) ──
create policy "Signed-in users can read node locations"
  on public.node_locations for select to authenticated using (true);
create policy "Signed-in users can add node locations"
  on public.node_locations for insert to authenticated with check (true);
create policy "Signed-in users can edit node locations"
  on public.node_locations for update to authenticated using (true) with check (true);
create policy "Signed-in users can remove node locations"
  on public.node_locations for delete to authenticated using (true);

-- ── orchard_boundaries: read (heatmap), save (orchard-setup.html) ──
create policy "Signed-in users can read orchard boundaries"
  on public.orchard_boundaries for select to authenticated using (true);
create policy "Signed-in users can add orchard boundaries"
  on public.orchard_boundaries for insert to authenticated with check (true);
create policy "Signed-in users can edit orchard boundaries"
  on public.orchard_boundaries for update to authenticated using (true) with check (true);

-- ── rover_location: read only from the dashboard ──
create policy "Signed-in users can read rover location"
  on public.rover_location for select to authenticated using (true);

-- ── Only if field devices use the publishable key (see step 2) ──
-- create policy "Devices can insert trap data"
--   on public.trap_data for insert to anon with check (true);
-- create policy "Rover can insert its location"
--   on public.rover_location for insert to anon with check (true);

-- Note: "using (true)" means every signed-in user sees every trap. That's fine
-- while VerdanTech is the only user. Per-grower access comes later by adding an
-- organization column to these tables and tightening these conditions.
