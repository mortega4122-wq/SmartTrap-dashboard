-- SmartTrap dashboard: demo deployment for the demo login
--
-- Loads a simulated 10-trap orchard into one login's dashboard: temperature and
-- humidity every 30 minutes, beetle detections, a rover that collects the data
-- on a pass each morning, and an orchard boundary. Other logins never see it.
--
-- Readings cover the 4 days before the moment it runs, so the node detail
-- charts (last 5 days) stay full. A daily Supabase Cron job regenerates them
-- each morning after the rover's 6 am pass.
--
-- Before running
--   1. Run supabase/rls-policies.sql first.
--   2. Replace DEMO_ACCOUNT_EMAIL below with the demo login's email.
--
-- Then paste this whole file into the SQL Editor and click Run. Safe to re-run;
-- it also puts back demo nodes that were removed from the dashboard.
--
-- What the demo shows
--   demo-01 … demo-10  5 × 2 grid ~100 m apart in an almond block west of Merced
--   Beetles            4-day totals from a few to ~45, highest along the east
--                      edge, mostly at dusk, with an occasional exit (−1)
--   Temp / humidity    Similar at every trap: ~14 °C (57 °F) at dawn to ~32 °C
--                      (90 °F) mid-afternoon; humidity ~70% down to ~25%
--   Rover              Stops beside each trap at 6 am; a trap uploads what it
--                      buffered when the rover stops within WiFi range
--   demo-01            Missed on the latest pass (the rover stopped out of range)
--   demo-06            Stopped uploading two days earlier (needs a visit)
--   Battery            Fixed 6 V, like the current firmware

-- ── 1. Demo nodes and orchard boundary ──────────────────────
do $$
declare
  demo_email constant text := 'DEMO_ACCOUNT_EMAIL';  -- ← your demo login's email
  demo_id uuid;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'node_locations' and column_name = 'owner_id') then
    raise exception 'Run supabase/rls-policies.sql first.';
  end if;

  select id into demo_id from auth.users where lower(email) = lower(demo_email);
  if demo_id is null then
    raise exception 'No dashboard login uses "%". Put the demo login''s email near the top of this file.', demo_email;
  end if;

  insert into public.node_locations (node_id, latitude, longitude, owner_id) values
    ('demo-01', 37.35657, -120.93929, demo_id),
    ('demo-02', 37.35651, -120.93811, demo_id),
    ('demo-03', 37.35656, -120.93702, demo_id),
    ('demo-04', 37.35649, -120.93584, demo_id),
    ('demo-05', 37.35655, -120.93476, demo_id),
    ('demo-06', 37.35543, -120.93924, demo_id),
    ('demo-07', 37.35549, -120.93815, demo_id),
    ('demo-08', 37.35544, -120.93698, demo_id),
    ('demo-09', 37.35550, -120.93589, demo_id),
    ('demo-10', 37.35545, -120.93471, demo_id)
  on conflict (node_id) do update
    set latitude = excluded.latitude, longitude = excluded.longitude, owner_id = excluded.owner_id;

  -- Replaces any boundary the demo login drew in Orchard Setup.
  delete from public.orchard_boundaries where owner_id = demo_id;
  insert into public.orchard_boundaries (name, polygon_points, updated_at, owner_id)
  values ('Demo orchard',
          '[{"lat": 37.35722, "lng": -120.94012}, {"lat": 37.35725, "lng": -120.93392},
            {"lat": 37.35478, "lng": -120.93388}, {"lat": 37.35476, "lng": -120.94008}]',
          now(), demo_id);
end $$;

-- ── 2. Generator ────────────────────────────────────────────
-- Repeatable "random" number in [0, 1) for a text seed, so the same trap at the
-- same moment always gets the same reading.
create or replace function public.demo_rand(seed text)
returns double precision
language sql immutable parallel safe
as $$ select ('x' || substr(md5(seed), 1, 8))::bit(32)::bigint / 4294967296.0 $$;

-- Replaces the demo readings and rover pings with the 4 days before p_now.
create or replace function public.refresh_demo_data(p_now timestamptz default now())
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  local_now     timestamp := p_now at time zone 'America/Los_Angeles';  -- timestamps are California time
  win_start     timestamp := local_now - interval '4 days';
  demo_owner    uuid;
  reading_count integer;
  ping_count    integer;
begin
  select owner_id into demo_owner from node_locations where node_id like 'demo-%' limit 1;
  if demo_owner is null then
    raise exception 'No demo nodes found. Run supabase/demo-data.sql first.';
  end if;

  delete from trap_data where node_id like 'demo-%';
  delete from rover_location where owner_id = demo_owner;

  with
  -- Per trap: beetles per day, temp (°C) and humidity offsets, WiFi signal (dBm),
  -- seconds past the half hour it takes readings, and its stop on the rover route.
  nodes as (
    select p.*, n.latitude as lat, n.longitude as lon
    from (values
      ('demo-01',  2.0,  0.3, -1, -58,  397, 0),
      ('demo-02',  2.2, -0.2,  2, -54,  794, 1),
      ('demo-03',  3.4,  0.1,  0, -61, 1191, 2),
      ('demo-04',  5.8, -0.4,  3, -56, 1588, 3),
      ('demo-05', 14.5,  0.6, -3, -63,  185, 4),
      ('demo-06',  1.8, -0.5,  1, -67,  582, 9),
      ('demo-07',  1.6,  0.2, -2, -52,  979, 8),
      ('demo-08',  3.0, -0.1,  2, -59, 1376, 7),
      ('demo-09',  5.2,  0.4, -1, -55, 1773, 6),
      ('demo-10', 11.0,  0.0,  0, -60,  370, 5)
    ) as p (node_id, beetles_per_day, temp_offset, hum_offset, rssi, phase_s, stop_no)
    join node_locations n using (node_id)
  ),
  -- The rover leaves at 6 am each day and stops beside each trap about 4 minutes apart.
  -- One pass a day keeps every trap's latest readings from about the same time of day.
  passes as (
    select d + interval '6 hours' as pass_start
    from generate_series((win_start::date - 1)::timestamp, local_now::date::timestamp, interval '1 day') as d
  ),
  visits as (
    select nd.node_id, nd.lat, nd.lon, to_char(ps.pass_start, 'YYYYMMDDHH24') as pass_key,
           ps.pass_start + nd.stop_no * interval '4 minutes'
             + floor(demo_rand(nd.node_id || to_char(ps.pass_start, 'YYYYMMDDHH24') || 'stop') * 50) * interval '1 second' as visit_at,
           nd.rssi - 3 + floor(demo_rand(nd.node_id || to_char(ps.pass_start, 'YYYYMMDDHH24') || 'rssi') * 7)::int as rssi,
           -- demo-01: on the latest pass the rover stopped ~40 m away, outside WiFi range
           nd.node_id = 'demo-01'
             and ps.pass_start = (select max(pass_start) from passes where pass_start <= local_now) as out_of_range,
           -- demo-06: stopped responding two days ago
           nd.node_id = 'demo-06' and ps.pass_start > local_now - interval '48 hours' as trap_down
    from nodes nd cross join passes ps
  ),
  pings as (
    insert into rover_location (latitude, longitude, "timestamp", owner_id)
    select v.lat + case when v.out_of_range then 0.00030
                        else (demo_rand(v.node_id || v.pass_key || 'lat') - 0.5) * 0.00008 end,
           v.lon + case when v.out_of_range then 0.00028
                        else 0.00007 + (demo_rand(v.node_id || v.pass_key || 'lon') - 0.5) * 0.00004 end,
           to_char(v.visit_at, 'YYYY-MM-DD HH24:MI:SS'),
           demo_owner
    from visits v
    where v.visit_at between win_start and local_now
    order by v.visit_at
    returning 1
  ),
  -- Temperature and humidity every 30 minutes.
  slots as (
    select nd.node_id, nd.temp_offset, nd.hum_offset, s.reading_at,
           extract(epoch from (s.reading_at - s.reading_at::date)) / 3600.0 as hour_of_day
    from nodes nd
    cross join lateral generate_series(date_trunc('hour', win_start) + nd.phase_s * interval '1 second',
                                       local_now, interval '30 minutes') as s (reading_at)
    where s.reading_at >= win_start
  ),
  -- Daily cycle: coolest at 6:30 am, warmest at 3:30 pm. warmth runs from 0 (dawn)
  -- to 1 (afternoon); each dawn and afternoon gets its own values so days differ.
  cycle as (
    select sl.*,
           case when hour_of_day >= 6.5 and hour_of_day < 15.5 then (1 - cos(pi() * (hour_of_day - 6.5) / 9)) / 2
                when hour_of_day >= 15.5 then (1 + cos(pi() * (hour_of_day - 15.5) / 15)) / 2
                else (1 + cos(pi() * (hour_of_day + 8.5) / 15)) / 2 end as warmth,
           to_char(case when hour_of_day >= 15.5 then reading_at::date + 1 else reading_at::date end, 'YYYYMMDD') as dawn_key,
           to_char(case when hour_of_day < 6.5 then reading_at::date - 1 else reading_at::date end, 'YYYYMMDD') as afternoon_key
    from slots sl
  ),
  readings as (
    select c.node_id, c.reading_at,
           round((w.dawn_t + (w.aft_t - w.dawn_t) * c.warmth + c.temp_offset
                  + (demo_rand(c.node_id || to_char(c.reading_at, 'YYYYMMDDHH24MI') || 't') - 0.5) * 0.6)::numeric, 1) as temp_c,
           greatest(5, least(99, round(w.dawn_h + (w.aft_h - w.dawn_h) * c.warmth + c.hum_offset
                  + (demo_rand(c.node_id || to_char(c.reading_at, 'YYYYMMDDHH24MI') || 'h') - 0.5) * 4))) as humidity
    from cycle c
    cross join lateral (select 14 + (demo_rand('dawn-t' || c.dawn_key) - 0.5) * 2.4      as dawn_t,
                               32 + (demo_rand('aft-t'  || c.afternoon_key) - 0.5) * 3.0 as aft_t,
                               71 + (demo_rand('dawn-h' || c.dawn_key) - 0.5) * 8        as dawn_h,
                               25 + (demo_rand('aft-h'  || c.afternoon_key) - 0.5) * 6   as aft_h) as w
  ),
  -- Beetle entries: 4 chances per half hour, weighted toward dusk (hourly weights sum to 1).
  entries as (
    select nd.node_id,
           s.half_hour + floor(demo_rand(nd.node_id || to_char(s.half_hour, 'YYYYMMDDHH24MI') || k || 'at') * 1800)
                         * interval '1 second' as event_at
    from nodes nd
    cross join generate_series(date_trunc('hour', win_start), local_now, interval '30 minutes') as s (half_hour)
    cross join generate_series(1, 4) as k
    where demo_rand(nd.node_id || to_char(s.half_hour, 'YYYYMMDDHH24MI') || k)
          < nd.beetles_per_day / 8.0
            * (array[.04, .01, .01, .01, .01, .01, .01, .01, .01, .01, .02, .02,
                     .02, .03, .03, .04, .06, .09, .14, .16, .12, .07, .04, .03])[extract(hour from s.half_hour)::int + 1]
  ),
  -- About 1 in 20 beetles climbs back out within a few minutes.
  exits as (
    select e.node_id,
           e.event_at + (20 + floor(demo_rand(e.node_id || to_char(e.event_at, 'YYYYMMDDHH24MISS') || 'exit-at') * 220))
                        * interval '1 second' as event_at
    from entries e
    where demo_rand(e.node_id || to_char(e.event_at, 'YYYYMMDDHH24MISS') || 'exit') < 0.05
  ),
  events as (
    select node_id, reading_at as event_at, 0 as kind, 'temp' as event_type, temp_c::float8 as event_value, 'C' as event_unit
    from readings
    union all select node_id, reading_at, 1, 'humidity', humidity, 'percent' from readings
    union all select node_id, event_at, 2, 'beetle_count_added', 1, 'count' from entries
    union all select node_id, event_at, 3, 'beetle_count_removed', 1, 'count' from exits
  ),
  numbered as (
    select ev.*, row_number() over (partition by ev.node_id order by ev.event_at, ev.kind) as seq
    from events ev
    where ev.event_at between win_start and local_now
  ),
  -- Each record uploads at the trap's next rover stop that was in range.
  uploaded as (
    select nb.*, up.visit_at, up.rssi
    from numbered nb
    cross join lateral (
      select v.visit_at, v.rssi
      from visits v
      where v.node_id = nb.node_id and v.visit_at >= nb.event_at and v.visit_at <= local_now
        and not v.out_of_range and not v.trap_down
      order by v.visit_at
      limit 1
    ) as up
  ),
  batched as (
    select u.*,
           row_number() over (partition by u.node_id, u.visit_at order by u.event_at, u.kind) as batch_pos,
           count(*) over (partition by u.node_id, u.visit_at) as batch_size
    from uploaded u
  )
  insert into trap_data (sequence_id, node_id, firmware_version, upload_timestamp, buffered_records,
                         event_timestamp, event_type, event_value, event_unit, battery_voltage,
                         signal_strength_rssi, event_millis)
  select b.seq::text, b.node_id, 'v5.0',
         -- one second apart within an upload, so the newest record sorts first
         to_char(b.visit_at + (b.batch_pos - 1) * interval '1 second', 'YYYY-MM-DD HH24:MI:SS'),
         b.batch_size,
         to_char(b.event_at, 'YYYY-MM-DD HH24:MI:SS'),
         b.event_type, b.event_value, b.event_unit,
         6,  -- battery isn't measured yet; the firmware sends 6
         b.rssi,
         (extract(epoch from (b.event_at - win_start)) * 1000)::bigint + 90000
  from batched b
  order by b.visit_at, b.node_id, b.batch_pos;

  get diagnostics reading_count = row_count;
  select count(*) into ping_count from rover_location where owner_id = demo_owner;

  return format('%s readings and %s rover pings, through %s California time',
                reading_count, ping_count, to_char(local_now, 'YYYY-MM-DD HH24:MI'));
end $$;

revoke execute on function public.demo_rand(text) from public, anon, authenticated;
revoke execute on function public.refresh_demo_data(timestamptz) from public, anon, authenticated;

-- ── 3. Load it now ──────────────────────────────────────────
select public.refresh_demo_data();

-- ── 4. Refresh every day at 16:00 UTC (9 am PDT / 8 am PST) ──
-- That's after the rover's 6 am pass. If Supabase Cron can't be turned on, the
-- result below says why; enable it under Integrations → Cron, then re-run this file.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('smarttrap-demo-refresh', '0 16 * * *', 'select public.refresh_demo_data()');
  perform set_config('smarttrap.demo_refresh', 'daily at 16:00 UTC', false);
exception when others then
  perform set_config('smarttrap.demo_refresh', 'not scheduled: ' || sqlerrm, false);
end $$;

-- ── Result ──────────────────────────────────────────────────
select (select count(*) from public.node_locations where node_id like 'demo-%') as demo_nodes,
       (select count(*) from public.trap_data where node_id like 'demo-%')      as readings,
       (select count(*) from public.rover_location
         where owner_id = (select owner_id from public.node_locations where node_id like 'demo-%' limit 1)) as rover_pings,
       current_setting('smarttrap.demo_refresh', true) as daily_refresh;

-- ── Later ───────────────────────────────────────────────────
-- Fresh copy right before a demo:
--   select public.refresh_demo_data();
--
-- Stop the daily refresh:
--   select cron.unschedule('smarttrap-demo-refresh');
--
-- Remove the demo completely (run in this order):
--   select cron.unschedule('smarttrap-demo-refresh');
--   delete from public.rover_location
--     where owner_id = (select owner_id from public.node_locations where node_id like 'demo-%' limit 1);
--   delete from public.orchard_boundaries
--     where owner_id = (select owner_id from public.node_locations where node_id like 'demo-%' limit 1);
--   delete from public.trap_data where node_id like 'demo-%';
--   delete from public.node_locations where node_id like 'demo-%';
--   drop function public.refresh_demo_data(timestamptz);
--   drop function public.demo_rand(text);
