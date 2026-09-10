-- Demo requests from the website's Contact Us page (contact.html).
--
-- Run once in the Supabase SQL Editor. Until this table exists, the form shows
-- an error when someone submits it.
--
-- Website visitors can only ADD rows; they can't read, edit, or delete them.
-- To see requests, open Table Editor → demo_requests in Supabase (the dashboard
-- bypasses these rules). Dashboard users signed in to /dashboard/ can't read
-- them either, since no SELECT policy exists.

create table if not exists public.demo_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  full_name    text not null check (char_length(full_name) between 1 and 200),
  email        text not null check (char_length(email) <= 320 and email like '%_@_%'),
  phone        text check (char_length(phone) <= 50),
  organization text check (char_length(organization) <= 200),
  role         text check (char_length(role) <= 100),
  crop         text check (char_length(crop) <= 100),
  location     text not null check (char_length(location) between 1 and 200),
  acreage      text check (char_length(acreage) <= 50),
  timeframe    text check (char_length(timeframe) <= 50),
  message      text check (char_length(message) <= 5000),
  status       text not null default 'new'   -- for your own tracking: new, contacted, scheduled, done
);

alter table public.demo_requests enable row level security;

grant insert on public.demo_requests to anon, authenticated;

create policy "Website visitors can submit demo requests"
  on public.demo_requests for insert to anon, authenticated
  with check (status = 'new');
