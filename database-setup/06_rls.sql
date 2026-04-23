-- =========================
-- RLS
-- Basic owner/member policies.
-- Tighten further later if needed.
-- =========================

alter table public.schools enable row level security;
alter table public.user_schools enable row level security;
alter table public.sections enable row level security;
alter table public.user_sections enable row level security;
alter table public.courses enable row level security;
alter table public.user_courses enable row level security;
alter table public.subjects enable row level security;
alter table public.user_subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_plans enable row level security;
alter table public.slots enable row level security;
alter table public.blocks enable row level security;
alter table public.plan_subject_content enable row level security;
alter table public.school_calendar_events enable row level security;
alter table public.delays enable row level security;

-- schools
drop policy if exists "users can read member schools" on public.schools;
create policy "users can read member schools"
on public.schools for select
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = schools.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can insert schools" on public.schools;
create policy "users can insert schools"
on public.schools for insert
with check (auth.uid() = created_by);

drop policy if exists "users can update own created schools" on public.schools;
create policy "users can update own created schools"
on public.schools for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

-- user_schools
drop policy if exists "users can read own school memberships" on public.user_schools;
create policy "users can read own school memberships"
on public.user_schools for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own school memberships" on public.user_schools;
create policy "users can insert own school memberships"
on public.user_schools for insert
with check (auth.uid() = user_id);

-- sections
drop policy if exists "users can read sections in own schools" on public.sections;
create policy "users can read sections in own schools"
on public.sections for select
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = sections.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage sections in own schools" on public.sections;
create policy "users can manage sections in own schools"
on public.sections for all
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = sections.school_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = sections.school_id
      and us.user_id = auth.uid()
  )
);

-- user_sections
drop policy if exists "users can read own section memberships" on public.user_sections;
create policy "users can read own section memberships"
on public.user_sections for select
using (auth.uid() = user_id);

drop policy if exists "users can manage own section memberships" on public.user_sections;
create policy "users can manage own section memberships"
on public.user_sections for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- courses
drop policy if exists "users can read courses in own schools" on public.courses;
create policy "users can read courses in own schools"
on public.courses for select
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = courses.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage courses in own schools" on public.courses;
create policy "users can manage courses in own schools"
on public.courses for all
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = courses.school_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = courses.school_id
      and us.user_id = auth.uid()
  )
);

-- user_courses
drop policy if exists "users can read own course memberships" on public.user_courses;
create policy "users can read own course memberships"
on public.user_courses for select
using (auth.uid() = user_id);

drop policy if exists "users can manage own course memberships" on public.user_courses;
create policy "users can manage own course memberships"
on public.user_courses for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- subjects
drop policy if exists "users can read subjects in own schools" on public.subjects;
create policy "users can read subjects in own schools"
on public.subjects for select
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = subjects.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage subjects in own schools" on public.subjects;
create policy "users can manage subjects in own schools"
on public.subjects for all
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = subjects.school_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = subjects.school_id
      and us.user_id = auth.uid()
  )
);

-- user_subjects
drop policy if exists "users can read own subject memberships" on public.user_subjects;
create policy "users can read own subject memberships"
on public.user_subjects for select
using (auth.uid() = user_id);

drop policy if exists "users can manage own subject memberships" on public.user_subjects;
create policy "users can manage own subject memberships"
on public.user_subjects for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- chapters
drop policy if exists "users can read chapters through accessible subjects" on public.chapters;
create policy "users can read chapters through accessible subjects"
on public.chapters for select
using (
  exists (
    select 1
    from public.subjects s
    join public.user_schools us on us.school_id = s.school_id
    where s.subject_id = chapters.subject_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage chapters through accessible subjects" on public.chapters;
create policy "users can manage chapters through accessible subjects"
on public.chapters for all
using (
  exists (
    select 1
    from public.subjects s
    join public.user_schools us on us.school_id = s.school_id
    where s.subject_id = chapters.subject_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.subjects s
    join public.user_schools us on us.school_id = s.school_id
    where s.subject_id = chapters.subject_id
      and us.user_id = auth.uid()
  )
);

-- lessons
drop policy if exists "users can read lessons through accessible chapters" on public.lessons;
create policy "users can read lessons through accessible chapters"
on public.lessons for select
using (
  exists (
    select 1
    from public.chapters c
    join public.subjects s on s.subject_id = c.subject_id
    join public.user_schools us on us.school_id = s.school_id
    where c.chapter_id = lessons.chapter_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage lessons through accessible chapters" on public.lessons;
create policy "users can manage lessons through accessible chapters"
on public.lessons for all
using (
  exists (
    select 1
    from public.chapters c
    join public.subjects s on s.subject_id = c.subject_id
    join public.user_schools us on us.school_id = s.school_id
    where c.chapter_id = lessons.chapter_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.chapters c
    join public.subjects s on s.subject_id = c.subject_id
    join public.user_schools us on us.school_id = s.school_id
    where c.chapter_id = lessons.chapter_id
      and us.user_id = auth.uid()
  )
);

-- lesson_plans
drop policy if exists "users can read own lesson plans" on public.lesson_plans;
create policy "users can read own lesson plans"
on public.lesson_plans for select
using (auth.uid() = user_id);

drop policy if exists "users can manage own lesson plans" on public.lesson_plans;
create policy "users can manage own lesson plans"
on public.lesson_plans for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- slots
drop policy if exists "users can read slots from own lesson plans" on public.slots;
create policy "users can read slots from own lesson plans"
on public.slots for select
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = slots.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

drop policy if exists "users can manage slots from own lesson plans" on public.slots;
create policy "users can manage slots from own lesson plans"
on public.slots for all
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = slots.lesson_plan_id
      and lp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = slots.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

-- blocks
drop policy if exists "users can read blocks from own lesson plans" on public.blocks;
create policy "users can read blocks from own lesson plans"
on public.blocks for select
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = blocks.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

drop policy if exists "users can manage blocks from own lesson plans" on public.blocks;
create policy "users can manage blocks from own lesson plans"
on public.blocks for all
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = blocks.lesson_plan_id
      and lp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = blocks.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

-- plan_subject_content
drop policy if exists "users can read subject content from own lesson plans" on public.plan_subject_content;
create policy "users can read subject content from own lesson plans"
on public.plan_subject_content for select
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = plan_subject_content.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

drop policy if exists "users can manage subject content from own lesson plans" on public.plan_subject_content;
create policy "users can manage subject content from own lesson plans"
on public.plan_subject_content for all
using (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = plan_subject_content.lesson_plan_id
      and lp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.lesson_plans lp
    where lp.lesson_plan_id = plan_subject_content.lesson_plan_id
      and lp.user_id = auth.uid()
  )
);

-- school_calendar_events
drop policy if exists "users can read calendar events in own schools" on public.school_calendar_events;
create policy "users can read calendar events in own schools"
on public.school_calendar_events for select
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = school_calendar_events.school_id
      and us.user_id = auth.uid()
  )
);

drop policy if exists "users can manage calendar events in own schools" on public.school_calendar_events;
create policy "users can manage calendar events in own schools"
on public.school_calendar_events for all
using (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = school_calendar_events.school_id
      and us.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_schools us
    where us.school_id = school_calendar_events.school_id
      and us.user_id = auth.uid()
  )
);

-- delays
drop policy if exists "users can read own absences" on public.delays;
create policy "users can read own absences"
on public.delays for select
using (auth.uid() = user_id);

drop policy if exists "users can manage own absences" on public.delays;
create policy "users can manage own absences"
on public.delays for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
