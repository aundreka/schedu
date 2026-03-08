-- =========================
-- SHARED FUNCTIONS / TRIGGERS
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;
