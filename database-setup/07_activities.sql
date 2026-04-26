-- =========================
-- AI-GENERATED ACTIVITIES
-- =========================

create table if not exists public.activities (
  activity_id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('act_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid not null references public.users(userid) on delete cascade,
  school_id uuid not null references public.schools(school_id) on delete cascade,
  subject_id uuid not null references public.subjects(subject_id) on delete cascade,
  title text not null,
  category public.session_category not null,
  activity_type text not null check (
    activity_type in (
      'quiz',
      'assignment',
      'seatwork',
      'exam',
      'project',
      'lab_report',
      'activity',
      'other'
    )
  ),
  scope_lesson_ids uuid[] not null default '{}',
  scope_summary text,
  requirements jsonb not null default '{}'::jsonb,
  component_keys text[] not null default '{}',
  template_notes text,
  template_storage_path text,
  generation_notes text,
  generated_text text,
  generated_pdf_path text,
  generated_docx_path text,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_category_check check (
    category in ('written_work', 'performance_task')
  ),
  constraint activities_type_pair_check check (
    (category = 'written_work' and activity_type in ('quiz', 'assignment', 'seatwork', 'exam'))
    or
    (category = 'performance_task' and activity_type in ('project', 'lab_report', 'activity', 'other'))
  )
);

create index if not exists activities_user_id_idx on public.activities(user_id);
create index if not exists activities_school_id_idx on public.activities(school_id);
create index if not exists activities_subject_id_idx on public.activities(subject_id);
create index if not exists activities_category_idx on public.activities(category);
create index if not exists activities_activity_type_idx on public.activities(activity_type);
create index if not exists activities_status_idx on public.activities(status);
create index if not exists activities_created_at_idx on public.activities(created_at desc);

create or replace trigger trg_activities_updated_at
before update on public.activities
for each row execute function public.set_updated_at();
