-- =========================
-- ACADEMIC STRUCTURE
-- =========================

create table if not exists public.subjects (
  subject_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('sub_' || replace(gen_random_uuid()::text, '-', '')),
  school_id uuid not null references public.schools(school_id) on delete cascade,
  course_id uuid references public.courses(course_id) on delete set null,
  code text not null,
  title text not null,
  year text,
  academic_year text,
  unit_no integer,
  subject_image text,
  syllabus text,
  syllabus_kind text,
  syllabus_mime_type text,
  description text,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.user_subjects (
  user_id uuid not null references public.users(userid) on delete cascade,
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);

create index if not exists sections_school_id_idx on public.sections(school_id);
create index if not exists sections_status_idx on public.sections(status);
create index if not exists user_sections_section_id_idx on public.user_sections(section_id);

create index if not exists courses_school_id_idx on public.courses(school_id);
create index if not exists courses_status_idx on public.courses(status);
create index if not exists user_courses_course_id_idx on public.user_courses(course_id);

create index if not exists subjects_school_id_idx on public.subjects(school_id);
create index if not exists subjects_course_id_idx on public.subjects(course_id);
create index if not exists subjects_status_idx on public.subjects(status);
create index if not exists user_subjects_subject_id_idx on public.user_subjects(subject_id);

create or replace trigger trg_sections_updated_at
before update on public.sections
for each row execute function public.set_updated_at();

create or replace trigger trg_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

create or replace trigger trg_subjects_updated_at
before update on public.subjects
for each row execute function public.set_updated_at();

create table if not exists public.units (
  unit_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('unt_' || replace(gen_random_uuid()::text, '-', '')),
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  title text not null,
  description text,
  sequence_no integer not null,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, sequence_no)
);

create table if not exists public.chapters (
  chapter_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('chp_' || replace(gen_random_uuid()::text, '-', '')),
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  unit_id uuid references public.units(unit_id) on delete set null,
  title text not null,
  description text,
  sequence_no integer not null,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, sequence_no)
);

create table if not exists public.lessons (
  lesson_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('les_' || replace(gen_random_uuid()::text, '-', '')),
  chapter_id uuid not null references public.chapters(chapter_id) on delete cascade,
  title text not null,
  content text,
  learning_objectives text,
  estimated_minutes integer,
  sequence_no integer not null,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, sequence_no)
);

alter table public.chapters
  add column if not exists unit_id uuid references public.units(unit_id) on delete set null;

create index if not exists units_subject_id_idx on public.units(subject_id);
create index if not exists units_status_idx on public.units(status);
create index if not exists chapters_subject_id_idx on public.chapters(subject_id);
create index if not exists chapters_unit_id_idx on public.chapters(unit_id);
create index if not exists chapters_status_idx on public.chapters(status);
create index if not exists lessons_chapter_id_idx on public.lessons(chapter_id);
create index if not exists lessons_status_idx on public.lessons(status);

create or replace trigger trg_units_updated_at
before update on public.units
for each row execute function public.set_updated_at();

create or replace trigger trg_chapters_updated_at
before update on public.chapters
for each row execute function public.set_updated_at();

create or replace trigger trg_lessons_updated_at
before update on public.lessons
for each row execute function public.set_updated_at();
