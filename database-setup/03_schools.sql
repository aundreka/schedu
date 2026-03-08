-- =========================
-- SCHOOLS AND MEMBERSHIP
-- =========================

create table if not exists public.schools (
  school_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('sch_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  type public.school_type not null,
  avatar_url text,
  avatar_color text not null default '#22C55E',
  is_default boolean not null default false,
  created_by uuid references public.users(userid) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_schools (
  user_id uuid not null references public.users(userid) on delete cascade,
  school_id uuid not null references public.schools(school_id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, school_id)
);

create index if not exists schools_type_idx on public.schools(type);
create index if not exists schools_created_by_idx on public.schools(created_by);
create index if not exists user_schools_school_id_idx on public.user_schools(school_id);
create index if not exists user_schools_user_id_primary_idx on public.user_schools(user_id, is_primary);

create or replace trigger trg_schools_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

create table if not exists public.sections (
  section_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('sec_' || replace(gen_random_uuid()::text, '-', '')),
  school_id uuid not null references public.schools(school_id) on delete cascade,
  grade_level text,
  name text not null,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.user_sections (
  user_id uuid not null references public.users(userid) on delete cascade,
  section_id uuid not null references public.sections(section_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, section_id)
);
