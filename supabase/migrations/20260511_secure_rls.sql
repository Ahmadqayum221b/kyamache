-- Migration: Final Secure RLS & Fix 500 Error
-- Removes all legacy leaks and ensures strict user-based isolation.

-- 1. DROP ALL LEGACY POLICIES (Absolute Cleanup)
drop policy if exists "anon_read" on entries;
drop policy if exists "anon_read_active" on entries;
drop policy if exists "public_read_shared" on entries;
drop policy if exists "auth_insert" on entries;
drop policy if exists "owner_modify" on entries;
drop policy if exists "owner_delete" on entries;
drop policy if exists "Users can manage own entries" on entries;
drop policy if exists "Members can view family entries" on entries;
drop policy if exists "Limited members view restricted family entries" on entries;
drop policy if exists "family_member_read" on entries;
drop policy if exists "entries_select" on entries;
drop policy if exists "entries_insert" on entries;
drop policy if exists "entries_update" on entries;
drop policy if exists "entries_delete" on entries;

-- 2. RESET user_id column (Remove default to fix 500 error)
alter table entries alter column user_id drop default;

-- 3. CREATE FRESH SECURE POLICIES
create policy "entries_select_isolated" on entries
  for select using (
    (auth.uid()::text = user_id) 
    or (is_public = true)
  );

create policy "entries_insert_isolated" on entries
  for insert with check (
    auth.uid()::text = user_id
  );

create policy "entries_modify_isolated" on entries
  for update using (auth.uid()::text = user_id);

create policy "entries_delete_isolated" on entries
  for delete using (auth.uid()::text = user_id);

-- 4. APPLY TO COLLECTIONS AS WELL
drop policy if exists "collections_owner_all" on collections;
create policy "collections_isolated" on collections
  for all using (auth.uid()::text = user_id);
