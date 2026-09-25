-- recruitflow initial schema
-- Every row carries recruiter_id; RLS restricts each recruiter to their own rows.

create extension if not exists pgcrypto;

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  location text not null default '',
  description text not null default '',
  constraints text not null default '',
  -- 'built' = form created in-app (responses read via Forms API)
  -- 'linked' = existing form; responses read from its Sheet
  form_source text not null default 'built' check (form_source in ('built', 'linked')),
  google_form_id text,
  google_form_url text,
  sheet_id text,
  sheet_range text default 'A:ZZ',
  last_synced_at timestamptz,
  last_sync_error text,
  recheck_threshold numeric(3,2) not null default 0.70 check (recheck_threshold between 0 and 1),
  require_signoff boolean not null default true,
  current_rubric_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- rubrics (versioned, immutable once approved) ----------
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  bias_reviewed boolean not null default false,
  source text not null default 'claude' check (source in ('claude', 'recruiter')),
  model text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (job_id, version)
);

alter table public.jobs
  add constraint jobs_current_rubric_fk foreign key (current_rubric_id)
  references public.rubrics(id) on delete set null;

create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  position int not null default 0,
  kind text not null check (kind in ('hard', 'soft')),
  name text not null,
  description text not null default '',
  weight int not null default 0 check (weight between 0 and 100),
  source_constraint text,       -- the recruiter constraint a hard filter came from
  bias_flag text,               -- Claude's note if the criterion may proxy a protected trait
  enabled boolean not null default true
);

-- ---------- application form (in-app builder) ----------
create table public.form_questions (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  position int not null default 0,
  title text not null,
  type text not null check (type in ('short', 'paragraph', 'choice', 'dropdown', 'checkbox', 'date')),
  required boolean not null default false,
  options text[] not null default '{}',
  role text check (role in ('name', 'email', 'resume')),  -- maps answers to candidate fields
  google_item_id text
);

-- ---------- pipeline stages ----------
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  position int not null default 0,
  prompt_calendar boolean not null default false
);

-- ---------- candidates ----------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  external_id text not null,    -- Forms responseId or "row:<n>" for Sheet rows
  name text not null default '',
  email text,
  resume_url text,
  answers jsonb not null default '[]'::jsonb,  -- [{question, answer}]
  submitted_at timestamptz,
  stage_id uuid references public.stages(id) on delete set null,
  score_status text not null default 'pending'
    check (score_status in ('pending', 'scoring', 'scored', 'error')),
  score_error text,
  created_at timestamptz not null default now(),
  unique (job_id, external_id)
);

-- ---------- evaluations (one per candidate per rubric version) ----------
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  score int not null check (score between 0 and 100),
  confidence numeric(4,3) not null,
  disqualified boolean not null default false,
  needs_review boolean not null default false,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (candidate_id, rubric_id)
);

create table public.criterion_results (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria(id) on delete cascade,
  decision text not null check (decision in ('meets', 'borderline', 'not_met', 'pass', 'fail', 'unclear')),
  confidence numeric(4,3) not null,
  evidence text not null default '',
  scored_by text not null check (scored_by in ('jev', 'claude')),
  initial_confidence numeric(4,3),       -- Jev's confidence before a Claude recheck
  probabilities jsonb,
  unique (evaluation_id, criterion_id)
);

-- ---------- interviews ----------
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete set null,
  starts_at timestamptz not null,
  duration_min int not null default 45,
  attendees text[] not null default '{}',
  google_event_id text,
  meet_url text,
  html_link text,
  created_at timestamptz not null default now()
);

-- ---------- email ----------
create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  template_id uuid references public.email_templates(id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  gmail_message_id text,
  sent_at timestamptz not null default now()
);

-- ---------- Google OAuth tokens (server-only: RLS on, no policies) ----------
create table public.google_connections (
  recruiter_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index on public.jobs (recruiter_id);
create index on public.rubrics (job_id);
create index on public.rubric_criteria (rubric_id);
create index on public.form_questions (job_id);
create index on public.stages (job_id);
create index on public.candidates (job_id, score_status);
create index on public.evaluations (rubric_id);
create index on public.criterion_results (evaluation_id);
create index on public.interviews (job_id, starts_at);
create index on public.email_sends (recruiter_id, sent_at desc);

-- ---------- row-level security ----------
do $$
declare t text;
begin
  foreach t in array array[
    'jobs','rubrics','rubric_criteria','form_questions','stages','candidates',
    'evaluations','criterion_results','interviews','email_templates','email_sends'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (recruiter_id = (select auth.uid()))
         with check (recruiter_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.google_connections enable row level security;
-- intentionally no policies: only the service role (server) reads refresh tokens

-- Non-secret connection status for the signed-in recruiter
create view public.google_connection_status
with (security_invoker = false) as
  select recruiter_id, google_email, scopes, updated_at
  from public.google_connections
  where recruiter_id = auth.uid();
grant select on public.google_connection_status to authenticated;

-- Live pipeline updates
alter publication supabase_realtime add table public.candidates;
