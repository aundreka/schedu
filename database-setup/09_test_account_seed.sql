begin;

create extension if not exists pgcrypto;

-- Test login:
--   username: test.teacher
--   email:    schedu.test.teacher@example.com
--   password: ScheduTest2026!
--
-- Run this after database-setup/00_users.sql through 08_billing.sql.
-- The app's Library screen reads "books" from subjects assigned through user_subjects.

with seed_user(user_id, public_id, first_name, last_name, username, email, role_name) as (
  values (
    '7f6e9c2a-1b31-4b17-9d8a-cfd1a2e75318'::uuid,
    'usr_schedu_test_teacher',
    'Alex',
    'Rivera',
    'test.teacher',
    'schedu.test.teacher@example.com',
    'teacher'
  )
)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  user_id,
  'authenticated',
  'authenticated',
  email,
  crypt('ScheduTest2026!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('first_name', first_name, 'last_name', last_name),
  false,
  '',
  '',
  '',
  ''
from seed_user
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

with seed_user(user_id, public_id, first_name, last_name, username, email, role_name) as (
  values (
    '7f6e9c2a-1b31-4b17-9d8a-cfd1a2e75318'::uuid,
    'usr_schedu_test_teacher',
    'Alex',
    'Rivera',
    'test.teacher',
    'schedu.test.teacher@example.com',
    'teacher'
  )
)
insert into public.users (
  userid,
  publicid,
  first_name,
  last_name,
  username,
  email,
  role
)
select
  user_id,
  public_id,
  first_name,
  last_name,
  username,
  email,
  role_name::public.user_role
from seed_user
on conflict (userid) do update
set
  publicid = excluded.publicid,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  username = excluded.username,
  email = excluded.email,
  role = excluded.role,
  updated_at = now();

do $$
begin
  if to_regclass('public.subscriptions') is not null then
    insert into public.subscriptions (user_id, tier, status)
    select userid, 'tier2'::public.subscription_tier, 'active'::public.subscription_status
    from public.users
    where publicid = 'usr_schedu_test_teacher'
    on conflict (user_id) do update
    set
      tier = excluded.tier,
      status = excluded.status,
      updated_at = now();
  end if;

  if to_regclass('public.usage_quotas') is not null then
    insert into public.usage_quotas (user_id, period_month, ai_generations_used)
    select userid, date_trunc('month', current_date)::date, 0
    from public.users
    where publicid = 'usr_schedu_test_teacher'
    on conflict (user_id, period_month) do update
    set
      ai_generations_used = excluded.ai_generations_used,
      updated_at = now();
  end if;
end $$;

alter table public.lesson_plans
  add column if not exists archived_at timestamptz;

with school_seed(public_id, name, type_name, avatar_color, is_default, created_by_public_id) as (
  values (
    'sch_arcadia_state_university',
    'Arcadia State University',
    'university',
    '#2563EB',
    true,
    'usr_schedu_test_teacher'
  )
)
insert into public.schools (
  public_id,
  name,
  type,
  avatar_color,
  is_default,
  created_by
)
select
  school_seed.public_id,
  school_seed.name,
  school_seed.type_name::public.school_type,
  school_seed.avatar_color,
  school_seed.is_default,
  users.userid
from school_seed
join public.users on users.publicid = school_seed.created_by_public_id
on conflict (public_id) do update
set
  name = excluded.name,
  type = excluded.type,
  avatar_color = excluded.avatar_color,
  is_default = excluded.is_default,
  created_by = excluded.created_by,
  updated_at = now();

insert into public.user_schools (
  user_id,
  school_id,
  is_primary
)
select
  users.userid,
  schools.school_id,
  true
from public.users
join public.schools on schools.public_id = 'sch_arcadia_state_university'
where users.publicid = 'usr_schedu_test_teacher'
on conflict (user_id, school_id) do update
set is_primary = excluded.is_primary;

with section_seed(public_id, grade_level, name, status_name) as (
  values
    ('sec_asu_bscs_2a', '2nd Year', 'BSCS 2A', 'published'),
    ('sec_asu_bsed_3b', '3rd Year', 'BSED 3B', 'published')
)
insert into public.sections (
  public_id,
  school_id,
  grade_level,
  name,
  status
)
select
  section_seed.public_id,
  schools.school_id,
  section_seed.grade_level,
  section_seed.name,
  section_seed.status_name::public.record_status
from section_seed
join public.schools on schools.public_id = 'sch_arcadia_state_university'
on conflict (school_id, name) do update
set
  public_id = excluded.public_id,
  grade_level = excluded.grade_level,
  status = excluded.status,
  updated_at = now();

insert into public.user_sections (
  user_id,
  section_id
)
select
  users.userid,
  sections.section_id
from public.users
join public.schools on schools.public_id = 'sch_arcadia_state_university'
join public.sections on sections.school_id = schools.school_id
where users.publicid = 'usr_schedu_test_teacher'
  and sections.public_id in ('sec_asu_bscs_2a', 'sec_asu_bsed_3b')
on conflict (user_id, section_id) do nothing;

with subject_seed(public_id, code, title, year_level, academic_year, unit_no, description, status_name) as (
  values
    (
      'sub_asu_cs201',
      'CS201',
      'Data Structures and Algorithms',
      '2nd Year',
      '2026-2027',
      4,
      'A practical programming course on data representation, structure selection, complexity, and algorithmic problem solving.',
      'published'
    ),
    (
      'sub_asu_ed301',
      'ED301',
      'Assessment of Learning',
      '3rd Year',
      '2026-2027',
      4,
      'A teacher education course on alignment, test design, performance assessment, feedback, and ethical reporting.',
      'published'
    )
)
insert into public.subjects (
  public_id,
  school_id,
  code,
  title,
  year,
  academic_year,
  unit_no,
  description,
  status
)
select
  subject_seed.public_id,
  schools.school_id,
  subject_seed.code,
  subject_seed.title,
  subject_seed.year_level,
  subject_seed.academic_year,
  subject_seed.unit_no,
  subject_seed.description,
  subject_seed.status_name::public.record_status
from subject_seed
join public.schools on schools.public_id = 'sch_arcadia_state_university'
on conflict (school_id, code) do update
set
  public_id = excluded.public_id,
  title = excluded.title,
  year = excluded.year,
  academic_year = excluded.academic_year,
  unit_no = excluded.unit_no,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into public.user_subjects (
  user_id,
  subject_id
)
select
  users.userid,
  subjects.subject_id
from public.users
join public.subjects on subjects.public_id in ('sub_asu_cs201', 'sub_asu_ed301')
where users.publicid = 'usr_schedu_test_teacher'
on conflict (user_id, subject_id) do nothing;

with unit_seed(subject_public_id, sequence_no, public_id, title, description) as (
  values
    ('sub_asu_cs201', 1, 'unt_asu_cs201_linear', 'Linear Structures', 'Arrays, abstract data types, linked lists, stacks, queues, and use-case tradeoffs.'),
    ('sub_asu_cs201', 2, 'unt_asu_cs201_trees_hashing', 'Trees and Hashing', 'Tree traversal, heaps, dictionaries, hashing, and collision management.'),
    ('sub_asu_cs201', 3, 'unt_asu_cs201_graphs', 'Graphs and Traversal', 'Graph representations, breadth-first search, depth-first search, and pathfinding foundations.'),
    ('sub_asu_cs201', 4, 'unt_asu_cs201_strategies', 'Algorithmic Strategies', 'Greedy methods, dynamic programming, complexity comparisons, and implementation review.'),
    ('sub_asu_ed301', 1, 'unt_asu_ed301_foundations', 'Assessment Foundations', 'Purposes of assessment, constructive alignment, outcomes, evidence, and fairness.'),
    ('sub_asu_ed301', 2, 'unt_asu_ed301_tests', 'Classroom Test Design', 'Table of specifications, objective item writing, item analysis, and reliability checks.'),
    ('sub_asu_ed301', 3, 'unt_asu_ed301_performance', 'Performance Assessment', 'Authentic tasks, criteria, rubrics, portfolios, and learner reflection.'),
    ('sub_asu_ed301', 4, 'unt_asu_ed301_feedback', 'Feedback and Reporting', 'Feedback cycles, grading decisions, progress reporting, data privacy, and ethical use of results.')
)
insert into public.units (
  public_id,
  subject_id,
  title,
  description,
  sequence_no,
  status
)
select
  unit_seed.public_id,
  subjects.subject_id,
  unit_seed.title,
  unit_seed.description,
  unit_seed.sequence_no,
  'published'::public.record_status
from unit_seed
join public.subjects on subjects.public_id = unit_seed.subject_public_id
on conflict (subject_id, sequence_no) do update
set
  public_id = excluded.public_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

with chapter_seed(subject_public_id, unit_sequence_no, sequence_no, public_id, title, description) as (
  values
    ('sub_asu_cs201', 1, 1, 'chp_asu_cs201_adts', 'Arrays, ADTs, and Complexity', 'Introduces representation choices and basic asymptotic reasoning.'),
    ('sub_asu_cs201', 1, 2, 'chp_asu_cs201_stacks_queues', 'Stacks, Queues, and Linked Lists', 'Covers pointer-style structures and restricted access containers.'),
    ('sub_asu_cs201', 2, 3, 'chp_asu_cs201_trees_hashes', 'Trees, Heaps, and Hash Tables', 'Builds hierarchical and keyed structures for efficient lookup.'),
    ('sub_asu_cs201', 3, 4, 'chp_asu_cs201_graphs', 'Graphs and Algorithmic Strategies', 'Connects graph traversal with broader design patterns.'),
    ('sub_asu_ed301', 1, 1, 'chp_asu_ed301_alignment', 'Assessment Purpose and Alignment', 'Links outcomes, instruction, evidence, and feedback decisions.'),
    ('sub_asu_ed301', 2, 2, 'chp_asu_ed301_items', 'Test Construction and Item Quality', 'Develops quality selected-response and constructed-response items.'),
    ('sub_asu_ed301', 3, 3, 'chp_asu_ed301_rubrics', 'Rubrics and Performance Evidence', 'Uses explicit criteria to score authentic performance tasks.'),
    ('sub_asu_ed301', 4, 4, 'chp_asu_ed301_reporting', 'Feedback, Reporting, and Ethics', 'Turns assessment evidence into learner-centered reporting.')
)
insert into public.chapters (
  public_id,
  subject_id,
  unit_id,
  title,
  description,
  sequence_no,
  status
)
select
  chapter_seed.public_id,
  subjects.subject_id,
  units.unit_id,
  chapter_seed.title,
  chapter_seed.description,
  chapter_seed.sequence_no,
  'published'::public.record_status
from chapter_seed
join public.subjects on subjects.public_id = chapter_seed.subject_public_id
join public.units
  on units.subject_id = subjects.subject_id
 and units.sequence_no = chapter_seed.unit_sequence_no
on conflict (subject_id, sequence_no) do update
set
  public_id = excluded.public_id,
  unit_id = excluded.unit_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

with lesson_seed(subject_public_id, chapter_sequence_no, sequence_no, public_id, title, content, learning_objectives, estimated_minutes, complexity_score) as (
  values
    (
      'sub_asu_cs201',
      1,
      1,
      'les_asu_cs201_arrays_adts',
      'Arrays, Lists, and Abstract Data Types',
      $html$<h2>Overview</h2><p>Students compare arrays, dynamic lists, and abstract data types through a gradebook example. The lesson emphasizes the difference between an interface and an implementation.</p><h3>Flow</h3><ul><li>Warm-up: identify operations needed by a gradebook.</li><li>Mini-lecture: access, update, insert, delete, and traversal costs.</li><li>Pair task: choose a structure for three classroom software scenarios.</li></ul><p>Exit prompt: explain why fast random access is useful but not always enough.</p>$html$,
      'Distinguish an ADT from an implementation; compare array and list operations; justify a structure choice for a simple application.',
      90,
      3
    ),
    (
      'sub_asu_cs201',
      1,
      2,
      'les_asu_cs201_big_o',
      'Big-O Analysis in Classroom Problems',
      $html$<h2>Overview</h2><p>The class models running time by counting dominant operations instead of timing devices. Students read small code fragments and classify growth as constant, linear, quadratic, or logarithmic.</p><h3>Practice</h3><ul><li>Trace loops and nested loops with small input sizes.</li><li>Build a quick growth table.</li><li>Explain which term dominates as input grows.</li></ul><p>Students finish by rewriting a slow search routine and predicting the change in growth.</p>$html$,
      'Count basic operations; classify common growth rates; explain why asymptotic analysis supports design decisions.',
      90,
      4
    ),
    (
      'sub_asu_cs201',
      2,
      1,
      'les_asu_cs201_linked_lists',
      'Linked Lists and Pointer Thinking',
      $html$<h2>Overview</h2><p>Students use index cards to simulate nodes, links, insertion, deletion, and traversal. The activity makes pointer updates visible before implementation.</p><h3>Lab Notes</h3><ul><li>Draw node diagrams before coding.</li><li>Track head, tail, and current references.</li><li>Check edge cases for empty and single-node lists.</li></ul><p>The lesson closes with a debugging checklist for broken links and lost nodes.</p>$html$,
      'Represent a linked list with nodes and links; perform insertion and deletion steps; identify common pointer errors.',
      120,
      4
    ),
    (
      'sub_asu_cs201',
      2,
      2,
      'les_asu_cs201_stacks_queues',
      'Stacks and Queues',
      $html$<h2>Overview</h2><p>The lesson introduces restricted-access containers through undo history, browser navigation, print queues, and help desk tickets.</p><h3>Workshop</h3><ul><li>Implement push, pop, enqueue, and dequeue.</li><li>Match real workflows to LIFO or FIFO behavior.</li><li>Use a queue to simulate a small service desk.</li></ul><p>Students submit a short trace showing how the container state changes after each operation.</p>$html$,
      'Describe LIFO and FIFO behavior; implement stack and queue operations; choose between stacks and queues for workflow problems.',
      120,
      3
    ),
    (
      'sub_asu_cs201',
      3,
      1,
      'les_asu_cs201_trees',
      'Binary Trees and Traversal',
      $html$<h2>Overview</h2><p>Students build a binary search tree from enrollment numbers, then compare preorder, inorder, and postorder traversal outputs.</p><h3>Guided Work</h3><ul><li>Insert values while preserving the search property.</li><li>Trace recursive traversal calls.</li><li>Discuss balanced and unbalanced shapes.</li></ul><p>The exit task asks students to predict traversal order without running code.</p>$html$,
      'Build a binary search tree; trace common traversal strategies; explain the effect of tree shape on search performance.',
      120,
      4
    ),
    (
      'sub_asu_cs201',
      3,
      2,
      'les_asu_cs201_hashing',
      'Hash Tables and Collision Handling',
      $html$<h2>Overview</h2><p>The class treats a hash table as a fast dictionary and tests how different hash functions distribute student IDs into buckets.</p><h3>Activity</h3><ul><li>Compute hash values with modular arithmetic.</li><li>Resolve collisions with chaining and probing.</li><li>Evaluate load factor and lookup behavior.</li></ul><p>Students write a recommendation for when a hash table is preferable to a sorted list.</p>$html$,
      'Explain hashing and buckets; handle collisions; connect load factor to expected lookup performance.',
      90,
      4
    ),
    (
      'sub_asu_cs201',
      4,
      1,
      'les_asu_cs201_graphs',
      'Graph Representation and Traversal',
      $html$<h2>Overview</h2><p>Students model campus routes as a graph and compare adjacency lists with adjacency matrices. The lesson then demonstrates breadth-first and depth-first traversal.</p><h3>Practice</h3><ul><li>Convert a route map into vertices and edges.</li><li>Run BFS to find minimum-edge paths.</li><li>Run DFS to explore connected areas.</li></ul><p>Students reflect on which representation suits sparse and dense graphs.</p>$html$,
      'Represent graphs; perform BFS and DFS by hand; select an appropriate graph representation for a scenario.',
      120,
      4
    ),
    (
      'sub_asu_cs201',
      4,
      2,
      'les_asu_cs201_strategies',
      'Greedy and Dynamic Programming Patterns',
      $html$<h2>Overview</h2><p>The lesson contrasts greedy choices with dynamic programming using scheduling and coin-change examples. Students identify overlapping subproblems and optimal substructure.</p><h3>Application</h3><ul><li>Test a greedy solution and find a counterexample.</li><li>Build a small dynamic programming table.</li><li>Explain the tradeoff between memory and repeated work.</li></ul><p>The final check asks students to name clues that suggest a DP approach.</p>$html$,
      'Differentiate greedy and dynamic programming approaches; identify overlapping subproblems; construct a small DP table.',
      120,
      5
    ),
    (
      'sub_asu_ed301',
      1,
      1,
      'les_asu_ed301_assessment_purposes',
      'Assessment for, as, and of Learning',
      $html$<h2>Overview</h2><p>Students examine how assessment changes when the purpose is diagnosis, feedback, reflection, or certification. Examples come from actual lesson outcomes and classroom routines.</p><h3>Discussion</h3><ul><li>Classify assessment examples by purpose.</li><li>Connect evidence to instructional decisions.</li><li>Revise one assessment to make feedback more useful.</li></ul><p>The closing reflection asks future teachers to identify a moment when assessment should change instruction.</p>$html$,
      'Classify assessment purposes; connect assessment evidence to teaching action; design an assessment for feedback.',
      90,
      3
    ),
    (
      'sub_asu_ed301',
      1,
      2,
      'les_asu_ed301_outcomes_tos',
      'Learning Outcomes and Table of Specifications',
      $html$<h2>Overview</h2><p>The lesson shows how clear outcomes become a table of specifications. Students practice balancing content coverage, cognitive demand, and item count.</p><h3>Workshop</h3><ul><li>Revise vague outcomes into measurable outcomes.</li><li>Map outcomes to content areas and Bloom levels.</li><li>Draft a table of specifications for a short unit test.</li></ul><p>Students submit a one-page TOS draft with a short rationale.</p>$html$,
      'Write measurable learning outcomes; align items to content and cognition; draft a table of specifications.',
      120,
      4
    ),
    (
      'sub_asu_ed301',
      2,
      1,
      'les_asu_ed301_objective_items',
      'Writing Objective Test Items',
      $html$<h2>Overview</h2><p>Students evaluate multiple-choice, matching, and true-false items for clarity, alignment, and fairness. Poor items are revised into stronger assessment prompts.</p><h3>Practice</h3><ul><li>Identify clues, ambiguity, and mismatched difficulty.</li><li>Write plausible distractors based on misconceptions.</li><li>Peer-review items using a checklist.</li></ul><p>The session ends with a small item bank ready for pilot testing.</p>$html$,
      'Apply item-writing guidelines; create plausible distractors; revise weak test items for clarity and alignment.',
      120,
      4
    ),
    (
      'sub_asu_ed301',
      2,
      2,
      'les_asu_ed301_item_analysis',
      'Item Analysis and Test Improvement',
      $html$<h2>Overview</h2><p>The class interprets difficulty index, discrimination index, and distractor performance using a sample response table.</p><h3>Analysis Task</h3><ul><li>Compute basic item statistics.</li><li>Flag items for retain, revise, or discard.</li><li>Recommend changes based on evidence.</li></ul><p>Students prepare a brief memo explaining which items need revision and why.</p>$html$,
      'Compute basic item analysis metrics; interpret distractor data; recommend evidence-based test revisions.',
      90,
      4
    ),
    (
      'sub_asu_ed301',
      3,
      1,
      'les_asu_ed301_rubrics',
      'Analytic and Holistic Rubrics',
      $html$<h2>Overview</h2><p>Students compare analytic and holistic rubrics, then transform broad criteria into observable descriptors.</p><h3>Rubric Studio</h3><ul><li>Identify criteria that match the target outcome.</li><li>Write four performance levels with clear evidence.</li><li>Check descriptors for bias and vague language.</li></ul><p>The output is a rubric draft for a short classroom performance task.</p>$html$,
      'Differentiate analytic and holistic rubrics; write observable descriptors; align criteria with learning outcomes.',
      120,
      4
    ),
    (
      'sub_asu_ed301',
      3,
      2,
      'les_asu_ed301_performance_tasks',
      'Performance Task Design',
      $html$<h2>Overview</h2><p>The lesson guides students through designing authentic tasks with role, audience, product, standards, and constraints.</p><h3>Design Sprint</h3><ul><li>Define the real-world context and deliverable.</li><li>Match criteria to the intended learning evidence.</li><li>Plan supports, checkpoints, and reflection prompts.</li></ul><p>Students submit a task brief with rubric criteria and implementation notes.</p>$html$,
      'Design an authentic performance task; identify evidence of learning; plan scaffolds and scoring criteria.',
      120,
      5
    ),
    (
      'sub_asu_ed301',
      4,
      1,
      'les_asu_ed301_feedback',
      'Actionable Feedback Cycles',
      $html$<h2>Overview</h2><p>Students practice turning scores and observations into feedback that tells learners where they are, where they need to go, and what to do next.</p><h3>Feedback Lab</h3><ul><li>Sort feedback comments by usefulness.</li><li>Rewrite vague comments into actionable next steps.</li><li>Plan a revision cycle after assessment.</li></ul><p>The final task is a feedback plan for one assessment from the course portfolio.</p>$html$,
      'Write actionable feedback; connect feedback to revision opportunities; plan a feedback cycle after assessment.',
      90,
      3
    ),
    (
      'sub_asu_ed301',
      4,
      2,
      'les_asu_ed301_ethics',
      'Ethical Reporting and Learner Data Privacy',
      $html$<h2>Overview</h2><p>The lesson covers responsible handling of grades, assessment records, learner privacy, and communication with stakeholders.</p><h3>Case Analysis</h3><ul><li>Review scenarios involving grade disclosure and record handling.</li><li>Identify privacy risks and professional responsibilities.</li><li>Draft a communication note that protects learner dignity.</li></ul><p>Students close with a personal checklist for ethical assessment reporting.</p>$html$,
      'Identify ethical risks in reporting; protect learner assessment data; communicate results professionally and fairly.',
      90,
      4
    )
)
insert into public.lessons (
  public_id,
  chapter_id,
  title,
  content,
  learning_objectives,
  estimated_minutes,
  complexity_score,
  sequence_no,
  status
)
select
  lesson_seed.public_id,
  chapters.chapter_id,
  lesson_seed.title,
  lesson_seed.content,
  lesson_seed.learning_objectives,
  lesson_seed.estimated_minutes,
  lesson_seed.complexity_score,
  lesson_seed.sequence_no,
  'published'::public.record_status
from lesson_seed
join public.subjects on subjects.public_id = lesson_seed.subject_public_id
join public.chapters
  on chapters.subject_id = subjects.subject_id
 and chapters.sequence_no = lesson_seed.chapter_sequence_no
on conflict (chapter_id, sequence_no) do update
set
  public_id = excluded.public_id,
  title = excluded.title,
  content = excluded.content,
  learning_objectives = excluded.learning_objectives,
  estimated_minutes = excluded.estimated_minutes,
  complexity_score = excluded.complexity_score,
  status = excluded.status,
  updated_at = now();

with plan_seed(public_id, subject_public_id, section_public_id, title, academic_year, start_date, end_date, notes) as (
  values
    (
      'lp_asu_cs201_bscs2a_2026',
      'sub_asu_cs201',
      'sec_asu_bscs_2a',
      'CS201 Semester Plan - BSCS 2A',
      '2026-2027',
      '2026-05-18'::date,
      '2026-08-07'::date,
      'Current seeded plan covering linear structures, trees, hashing, graphs, and algorithmic strategies.'
    ),
    (
      'lp_asu_ed301_bsed3b_2026',
      'sub_asu_ed301',
      'sec_asu_bsed_3b',
      'ED301 Assessment Plan - BSED 3B',
      '2026-2027',
      '2026-05-19'::date,
      '2026-08-06'::date,
      'Current seeded plan covering alignment, item design, rubrics, feedback, and ethical reporting.'
    )
)
insert into public.lesson_plans (
  public_id,
  user_id,
  school_id,
  subject_id,
  section_id,
  title,
  academic_year,
  start_date,
  end_date,
  notes,
  status
)
select
  plan_seed.public_id,
  users.userid,
  schools.school_id,
  subjects.subject_id,
  sections.section_id,
  plan_seed.title,
  plan_seed.academic_year,
  plan_seed.start_date,
  plan_seed.end_date,
  plan_seed.notes,
  'published'::public.record_status
from plan_seed
join public.users on users.publicid = 'usr_schedu_test_teacher'
join public.schools on schools.public_id = 'sch_arcadia_state_university'
join public.subjects on subjects.public_id = plan_seed.subject_public_id
join public.sections on sections.public_id = plan_seed.section_public_id
on conflict (public_id) do update
set
  user_id = excluded.user_id,
  school_id = excluded.school_id,
  subject_id = excluded.subject_id,
  section_id = excluded.section_id,
  title = excluded.title,
  academic_year = excluded.academic_year,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  notes = excluded.notes,
  status = excluded.status,
  archived_at = null,
  updated_at = now();

with schedule_pattern(plan_public_id, iso_dow, start_time, end_time, meeting_type) as (
  values
    ('lp_asu_cs201_bscs2a_2026', 1, '08:00'::time, '09:30'::time, 'lecture'),
    ('lp_asu_cs201_bscs2a_2026', 3, '13:00'::time, '15:00'::time, 'laboratory'),
    ('lp_asu_ed301_bsed3b_2026', 2, '10:00'::time, '11:30'::time, 'lecture'),
    ('lp_asu_ed301_bsed3b_2026', 4, '10:00'::time, '11:30'::time, 'lecture')
),
slot_days as (
  select
    lesson_plans.lesson_plan_id,
    lesson_plans.public_id,
    lesson_plans.title,
    generated_day::date as slot_date,
    schedule_pattern.iso_dow,
    schedule_pattern.start_time,
    schedule_pattern.end_time,
    schedule_pattern.meeting_type
  from schedule_pattern
  join public.lesson_plans on lesson_plans.public_id = schedule_pattern.plan_public_id
  cross join lateral generate_series(lesson_plans.start_date, lesson_plans.end_date, interval '1 day') as generated_days(generated_day)
  where extract(isodow from generated_day)::integer = schedule_pattern.iso_dow
),
numbered_slots as (
  select
    slot_days.*,
    row_number() over (
      partition by lesson_plan_id, slot_date
      order by start_time, end_time
    ) as slot_number
  from slot_days
)
insert into public.slots (
  lesson_plan_id,
  title,
  slot_date,
  weekday,
  start_time,
  end_time,
  meeting_type,
  slot_number,
  series_key,
  is_locked
)
select
  lesson_plan_id,
  title,
  slot_date,
  case iso_dow
    when 1 then 'monday'
    when 2 then 'tuesday'
    when 3 then 'wednesday'
    when 4 then 'thursday'
    when 5 then 'friday'
    when 6 then 'saturday'
    else 'sunday'
  end::public.weekday_name,
  start_time,
  end_time,
  meeting_type::public.meeting_type,
  slot_number,
  public_id || '-' || iso_dow || '-' || start_time::text,
  false
from numbered_slots
on conflict (lesson_plan_id, slot_date, slot_number) do update
set
  title = excluded.title,
  weekday = excluded.weekday,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  meeting_type = excluded.meeting_type,
  series_key = excluded.series_key,
  is_locked = excluded.is_locked,
  updated_at = now();

with ordered_slots as (
  select
    slots.slot_id,
    slots.lesson_plan_id,
    slots.start_time,
    slots.end_time,
    slots.meeting_type,
    lesson_plans.public_id as plan_public_id,
    lesson_plans.subject_id,
    subjects.title as subject_title,
    row_number() over (
      partition by slots.lesson_plan_id
      order by slots.slot_date, slots.start_time, slots.slot_number
    ) as slot_sequence
  from public.slots
  join public.lesson_plans on lesson_plans.lesson_plan_id = slots.lesson_plan_id
  join public.subjects on subjects.subject_id = lesson_plans.subject_id
  where lesson_plans.public_id in ('lp_asu_cs201_bscs2a_2026', 'lp_asu_ed301_bsed3b_2026')
),
subject_lessons as (
  select
    subjects.subject_id,
    lessons.lesson_id,
    lessons.title as lesson_title,
    row_number() over (
      partition by subjects.subject_id
      order by chapters.sequence_no, lessons.sequence_no
    ) as lesson_sequence,
    count(*) over (partition by subjects.subject_id) as lesson_count
  from public.subjects
  join public.chapters on chapters.subject_id = subjects.subject_id
  join public.lessons on lessons.chapter_id = chapters.chapter_id
  where subjects.public_id in ('sub_asu_cs201', 'sub_asu_ed301')
),
block_source as (
  select
    ordered_slots.*,
    subject_lessons.lesson_id,
    subject_lessons.lesson_title
  from ordered_slots
  join subject_lessons
    on subject_lessons.subject_id = ordered_slots.subject_id
   and subject_lessons.lesson_sequence = ((ordered_slots.slot_sequence - 1) % subject_lessons.lesson_count) + 1
)
insert into public.blocks (
  lesson_plan_id,
  slot_id,
  lesson_id,
  algorithm_block_key,
  block_key,
  title,
  description,
  session_category,
  session_subcategory,
  meeting_type,
  start_time,
  end_time,
  required,
  splittable,
  preferred_session_type,
  dependency_keys,
  order_no,
  is_locked,
  metadata
)
select
  lesson_plan_id,
  slot_id,
  lesson_id,
  'seed-test-' || plan_public_id || '-' || slot_sequence,
  'seed-test-' || plan_public_id || '-' || slot_sequence,
  case
    when slot_sequence % 12 = 0 then 'Prelim Exam: ' || subject_title
    when slot_sequence % 7 = 0 then 'Performance Task: ' || subject_title
    when slot_sequence % 5 = 0 then 'Quiz: ' || subject_title
    else lesson_title
  end,
  case
    when slot_sequence % 12 = 0 then 'Seeded major assessment with checking and feedback time.'
    when slot_sequence % 7 = 0 then 'Seeded performance evidence aligned with the current unit.'
    when slot_sequence % 5 = 0 then 'Seeded formative written work for recent lessons.'
    else 'Seeded lesson block tied to a filled library lesson.'
  end,
  case
    when slot_sequence % 12 = 0 then 'exam'
    when slot_sequence % 7 = 0 then 'performance_task'
    when slot_sequence % 5 = 0 then 'written_work'
    else 'lesson'
  end::public.session_category,
  case
    when slot_sequence % 12 = 0 then 'prelim'
    when slot_sequence % 7 = 0 then
      case when meeting_type = 'laboratory' then 'lab_report' else 'project' end
    when slot_sequence % 5 = 0 then 'quiz'
    else meeting_type::text
  end::public.session_subcategory,
  meeting_type,
  start_time,
  end_time,
  true,
  false,
  case when meeting_type = 'laboratory' then 'laboratory' else 'lecture' end,
  '{}'::text[],
  1,
  false,
  jsonb_build_object(
    'source',
    'test_account_seed',
    'sequence',
    slot_sequence,
    'lesson_no',
    slot_sequence,
    'scope_lesson_ids',
    jsonb_build_array(lesson_id)
  )
from block_source
on conflict (lesson_plan_id, algorithm_block_key) do update
set
  slot_id = excluded.slot_id,
  lesson_id = excluded.lesson_id,
  block_key = excluded.block_key,
  title = excluded.title,
  description = excluded.description,
  session_category = excluded.session_category,
  session_subcategory = excluded.session_subcategory,
  meeting_type = excluded.meeting_type,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  required = excluded.required,
  splittable = excluded.splittable,
  preferred_session_type = excluded.preferred_session_type,
  dependency_keys = excluded.dependency_keys,
  order_no = excluded.order_no,
  is_locked = excluded.is_locked,
  metadata = excluded.metadata,
  updated_at = now();

delete from public.plan_subject_content
where lesson_plan_id in (
  select lesson_plan_id
  from public.lesson_plans
  where public_id in ('lp_asu_cs201_bscs2a_2026', 'lp_asu_ed301_bsed3b_2026')
);

with plan_subjects as (
  select lesson_plan_id, subject_id
  from public.lesson_plans
  where public_id in ('lp_asu_cs201_bscs2a_2026', 'lp_asu_ed301_bsed3b_2026')
)
insert into public.plan_subject_content (
  lesson_plan_id,
  subject_id,
  unit_id,
  content_level,
  sequence_no,
  selected_title,
  selected_content
)
select
  plan_subjects.lesson_plan_id,
  plan_subjects.subject_id,
  units.unit_id,
  'unit',
  units.sequence_no,
  units.title,
  units.description
from plan_subjects
join public.units on units.subject_id = plan_subjects.subject_id;

with plan_subjects as (
  select lesson_plan_id, subject_id
  from public.lesson_plans
  where public_id in ('lp_asu_cs201_bscs2a_2026', 'lp_asu_ed301_bsed3b_2026')
)
insert into public.plan_subject_content (
  lesson_plan_id,
  subject_id,
  unit_id,
  chapter_id,
  content_level,
  sequence_no,
  selected_title,
  selected_content
)
select
  plan_subjects.lesson_plan_id,
  plan_subjects.subject_id,
  chapters.unit_id,
  chapters.chapter_id,
  'chapter',
  chapters.sequence_no,
  chapters.title,
  chapters.description
from plan_subjects
join public.chapters on chapters.subject_id = plan_subjects.subject_id;

with selected_lessons as (
  select
    lesson_plans.lesson_plan_id,
    lesson_plans.subject_id,
    chapters.unit_id,
    chapters.chapter_id,
    lessons.lesson_id,
    lessons.title,
    lessons.content,
    lessons.learning_objectives,
    lessons.estimated_minutes,
    row_number() over (
      partition by lesson_plans.lesson_plan_id
      order by chapters.sequence_no, lessons.sequence_no
    ) as content_sequence
  from public.lesson_plans
  join public.chapters on chapters.subject_id = lesson_plans.subject_id
  join public.lessons on lessons.chapter_id = chapters.chapter_id
  where lesson_plans.public_id in ('lp_asu_cs201_bscs2a_2026', 'lp_asu_ed301_bsed3b_2026')
)
insert into public.plan_subject_content (
  lesson_plan_id,
  subject_id,
  unit_id,
  chapter_id,
  lesson_id,
  content_level,
  sequence_no,
  selected_title,
  selected_content,
  learning_objectives,
  estimated_minutes
)
select
  lesson_plan_id,
  subject_id,
  unit_id,
  chapter_id,
  lesson_id,
  'lesson',
  content_sequence,
  title,
  content,
  learning_objectives,
  estimated_minutes
from selected_lessons;

with activity_seed(public_id, subject_public_id, chapter_sequence_no, title, category, activity_type, scope_summary, requirements, component_keys, template_notes, generation_notes, generated_text) as (
  values
    (
      'act_asu_cs201_stack_queue_lab',
      'sub_asu_cs201',
      2,
      'Stack and Queue Simulation Lab',
      'performance_task',
      'activity',
      'Performance task covering linked structures, stacks, and queues.',
      '{"group_size":3,"duration_minutes":80,"deliverables":["state trace","source code","reflection"]}'::jsonb,
      array['task_brief','rubric','trace_sheet'],
      'Use a small help desk ticket workflow so LIFO and FIFO behavior can be compared.',
      'Include scoring criteria for correctness, trace clarity, and explanation.',
      'Students simulate a help desk queue, implement stack and queue operations, and explain how state changes after each request.'
    ),
    (
      'act_asu_cs201_hash_quiz',
      'sub_asu_cs201',
      3,
      'Hashing and Trees Concept Quiz',
      'written_work',
      'quiz',
      'Quiz covering binary tree traversal, hashing, collisions, and lookup behavior.',
      '{"items":20,"duration_minutes":35,"item_mix":["multiple_choice","trace","short_response"]}'::jsonb,
      array['quiz','answer_key'],
      'Include at least two traversal traces and one collision-resolution item.',
      'Generate concise explanations for the answer key.',
      'Twenty-item quiz with traversal order, hash bucket placement, and short explanations of expected lookup time.'
    ),
    (
      'act_asu_ed301_tos_assignment',
      'sub_asu_ed301',
      1,
      'Table of Specifications Assignment',
      'written_work',
      'assignment',
      'Assignment covering learning outcomes and table of specifications design.',
      '{"outputs":["revised outcomes","tos matrix","rationale"],"word_target":500}'::jsonb,
      array['assignment_sheet','rubric'],
      'Use one short teaching unit from the student teacher portfolio.',
      'Require alignment notes for content, cognition, and item count.',
      'Students revise outcomes, build a TOS matrix, and write a rationale explaining item distribution.'
    ),
    (
      'act_asu_ed301_rubric_project',
      'sub_asu_ed301',
      3,
      'Authentic Task and Rubric Project',
      'performance_task',
      'project',
      'Project covering performance task design, analytic rubric construction, and learner reflection.',
      '{"milestones":["task brief","rubric draft","peer review","final revision"],"levels":4}'::jsonb,
      array['project_brief','rubric_template','peer_review_form'],
      'Require criteria that are observable and aligned with one course outcome.',
      'Include a peer-review checklist for vague descriptors and missing evidence.',
      'Students design an authentic classroom task, build an analytic rubric, gather peer feedback, and revise the assessment package.'
    )
),
activity_scope as (
  select
    activity_seed.*,
    array_agg(lessons.lesson_id order by lessons.sequence_no) as scope_lesson_ids
  from activity_seed
  join public.subjects on subjects.public_id = activity_seed.subject_public_id
  join public.chapters
    on chapters.subject_id = subjects.subject_id
   and chapters.sequence_no = activity_seed.chapter_sequence_no
  join public.lessons on lessons.chapter_id = chapters.chapter_id
  group by
    activity_seed.public_id,
    activity_seed.subject_public_id,
    activity_seed.chapter_sequence_no,
    activity_seed.title,
    activity_seed.category,
    activity_seed.activity_type,
    activity_seed.scope_summary,
    activity_seed.requirements,
    activity_seed.component_keys,
    activity_seed.template_notes,
    activity_seed.generation_notes,
    activity_seed.generated_text
)
insert into public.activities (
  public_id,
  user_id,
  school_id,
  subject_id,
  title,
  category,
  activity_type,
  scope_lesson_ids,
  scope_summary,
  requirements,
  component_keys,
  template_notes,
  generation_notes,
  generated_text,
  status
)
select
  activity_scope.public_id,
  users.userid,
  schools.school_id,
  subjects.subject_id,
  activity_scope.title,
  activity_scope.category::public.session_category,
  activity_scope.activity_type,
  activity_scope.scope_lesson_ids,
  activity_scope.scope_summary,
  activity_scope.requirements,
  activity_scope.component_keys,
  activity_scope.template_notes,
  activity_scope.generation_notes,
  activity_scope.generated_text,
  'published'::public.record_status
from activity_scope
join public.users on users.publicid = 'usr_schedu_test_teacher'
join public.schools on schools.public_id = 'sch_arcadia_state_university'
join public.subjects on subjects.public_id = activity_scope.subject_public_id
on conflict (public_id) do update
set
  user_id = excluded.user_id,
  school_id = excluded.school_id,
  subject_id = excluded.subject_id,
  title = excluded.title,
  category = excluded.category,
  activity_type = excluded.activity_type,
  scope_lesson_ids = excluded.scope_lesson_ids,
  scope_summary = excluded.scope_summary,
  requirements = excluded.requirements,
  component_keys = excluded.component_keys,
  template_notes = excluded.template_notes,
  generation_notes = excluded.generation_notes,
  generated_text = excluded.generated_text,
  status = excluded.status,
  updated_at = now();

with event_seed(title, description, start_date, end_date, event_type, blackout_reason) as (
  values
    (
      'Arcadia State University Faculty Planning Day',
      'Seeded university event for testing calendar blackouts and plan context.',
      '2026-06-12'::date,
      '2026-06-12'::date,
      'school_event',
      'event'
    ),
    (
      'Prelim Assessment Week',
      'Seeded exam-week event for current test-account lesson plans.',
      '2026-07-20'::date,
      '2026-07-24'::date,
      'exam_week',
      'exam_week'
    )
)
insert into public.school_calendar_events (
  school_id,
  event_type,
  blackout_reason,
  title,
  description,
  start_date,
  end_date,
  is_whole_day,
  created_by
)
select
  schools.school_id,
  event_seed.event_type::public.calendar_event_type,
  event_seed.blackout_reason::public.plan_blackout_reason,
  event_seed.title,
  event_seed.description,
  event_seed.start_date,
  event_seed.end_date,
  true,
  users.userid
from event_seed
join public.schools on schools.public_id = 'sch_arcadia_state_university'
join public.users on users.publicid = 'usr_schedu_test_teacher'
where not exists (
  select 1
  from public.school_calendar_events existing
  where existing.school_id = schools.school_id
    and existing.title = event_seed.title
    and existing.start_date = event_seed.start_date
    and existing.end_date = event_seed.end_date
);

commit;
