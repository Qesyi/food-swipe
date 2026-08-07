-- food-swipe schema
-- Run this once in your Supabase project's SQL editor (Database > SQL Editor > New query).

create table if not exists rooms (
  code text primary key,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz default now()
);

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  room_code text references rooms(code) on delete cascade,
  place_id text not null,
  name text not null,
  rating numeric,
  price_level text,
  address text,
  maps_uri text,
  photo_name text
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  room_code text references rooms(code) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete cascade,
  device_id text not null,
  nickname text,
  vote boolean not null,
  created_at timestamptz default now(),
  unique (room_code, restaurant_id, device_id)
);

-- Row Level Security: open read/write for anyone holding the anon key.
-- Fine for a 2-person hobby app with no sensitive data. Do not reuse this
-- policy shape for anything that needs real access control.
alter table rooms enable row level security;
alter table restaurants enable row level security;
alter table votes enable row level security;

create policy "public read rooms" on rooms for select using (true);
create policy "public insert rooms" on rooms for insert with check (true);

create policy "public read restaurants" on restaurants for select using (true);
create policy "public insert restaurants" on restaurants for insert with check (true);

create policy "public read votes" on votes for select using (true);
create policy "public insert votes" on votes for insert with check (true);

-- Enable realtime on votes so both phones see matches live.
-- If this errors because the publication already includes the table, ignore it.
alter publication supabase_realtime add table votes;
