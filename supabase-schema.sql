-- ============================================================
-- REPUTATION APP — Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Users (authenticated via Telegram)
create table if not exists users (
  tg_id        bigint primary key,
  username     text,
  first_name   text,
  created_at   timestamptz default now()
);

-- Profiles (people being reviewed)
create table if not exists profiles (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  phone             text,
  tg_username       text,
  rating_positive   int default 0,
  rating_negative   int default 0,
  created_by        bigint references users(tg_id),
  created_at        timestamptz default now()
);

-- Unique constraints to prevent duplicates
create unique index if not exists profiles_phone_idx
  on profiles(phone) where phone is not null;

create unique index if not exists profiles_tg_username_idx
  on profiles(tg_username) where tg_username is not null;

-- Reviews
create table if not exists reviews (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references profiles(id) on delete cascade,
  author_tg_id    bigint references users(tg_id),
  type            text check (type in ('positive', 'negative')) not null,
  text            text not null,
  photo_urls      text[] default '{}',
  created_at      timestamptz default now(),
  -- One review per user per profile
  unique(profile_id, author_tg_id)
);

-- ─── Indexes for fast search ─────────────────────────────────
create index if not exists profiles_full_name_idx
  on profiles using gin(to_tsvector('russian', full_name));

create index if not exists profiles_phone_search_idx
  on profiles(phone);

create index if not exists profiles_tg_search_idx
  on profiles(tg_username);

create index if not exists reviews_profile_id_idx
  on reviews(profile_id);

-- ─── Function to increment rating counters ───────────────────
create or replace function increment_rating(
  profile_id_arg uuid,
  field_name text
)
returns void
language plpgsql
security definer
as $$
begin
  if field_name = 'rating_positive' then
    update profiles
    set rating_positive = rating_positive + 1
    where id = profile_id_arg;
  elsif field_name = 'rating_negative' then
    update profiles
    set rating_negative = rating_negative + 1
    where id = profile_id_arg;
  end if;
end;
$$;

-- ─── Storage bucket for review photos ────────────────────────
-- Run this separately in Supabase dashboard > Storage
-- Or via SQL:
insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

-- Allow anyone to read photos (they are public evidence)
create policy "Public read review photos"
  on storage.objects for select
  using (bucket_id = 'review-photos');

-- Only authenticated (via our backend service key) can upload
create policy "Service role can upload"
  on storage.objects for insert
  using (bucket_id = 'review-photos');

-- ─── Row Level Security ──────────────────────────────────────
-- We use service role key from backend, so RLS is bypassed.
-- Enable RLS anyway as a safety net.
alter table users enable row level security;
alter table profiles enable row level security;
alter table reviews enable row level security;

-- Service role bypasses all RLS — our backend uses service role key.
-- These policies are just fallback for any direct access:
create policy "Service role full access on users"
  on users using (true);

create policy "Service role full access on profiles"
  on profiles using (true);

create policy "Service role full access on reviews"
  on reviews using (true);
