-- Migration: Bulk Trash Support
-- Run this in your Supabase SQL Editor

CREATE OR REPLACE FUNCTION bulk_trash_entries(p_ids uuid[])
RETURNS void AS $$
BEGIN
  UPDATE entries 
  SET status = 'trashed', trashed_at = now()
  WHERE id = ANY(p_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
