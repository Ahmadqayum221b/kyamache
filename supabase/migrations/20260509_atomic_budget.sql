-- Atomic budget increment function
-- Fixes race conditions in budget tracking
CREATE OR REPLACE FUNCTION increment_daily_budget(p_day DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO daily_budget (day, cost_cents)
  VALUES (p_day, 1)
  ON CONFLICT (day)
  DO UPDATE SET 
    cost_cents = daily_budget.cost_cents + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
