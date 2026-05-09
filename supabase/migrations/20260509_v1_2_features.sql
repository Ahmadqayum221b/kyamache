-- Migration: Pinning, Collections, and Sharing Support
-- Run this in your Supabase SQL Editor

-- 1. Collections Table
create table if not exists collections (
  id          uuid primary key default uuid_generate_v4(),
  user_id     text not null,
  name        text not null,
  description text,
  color       text default '#6366f1', -- default indigo
  created_at  timestamptz default now()
);

-- 2. Add columns to entries
alter table entries
  add column if not exists is_pinned    boolean default false,
  add column if not exists collection_id uuid references collections(id) on delete set null,
  add column if not exists is_public    boolean default false,
  add column if not exists share_token   text unique default encode(gen_random_bytes(12), 'hex');

-- 3. Add indexes for performance
create index if not exists entries_pinned_idx on entries(is_pinned) where is_pinned = true;
create index if not exists entries_collection_idx on entries(collection_id);
create index if not exists entries_public_idx on entries(is_public) where is_public = true;

-- 4. RLS for Collections
alter table collections enable row level security;

create policy "collections_owner_all" on collections
  using (auth.uid()::text = user_id);

-- Enable RLS for entries sharing (Public Read)
create policy "public_read_shared" on entries
  for select using (is_public = true);
