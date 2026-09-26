-- Stage 2: recruiter-triggered deep evaluation from CV + portfolio + GitHub

-- Extra candidate links (filled from the form, editable by the recruiter)
alter table public.candidates
  add column portfolio_url text,
  add column github_url text;

-- Form questions can now map to portfolio / GitHub
alter table public.form_questions drop constraint form_questions_role_check;
alter table public.form_questions
  add constraint form_questions_role_check check (role in ('name', 'email', 'resume', 'portfolio', 'github'));

-- Stage-1 score at or above this puts a candidate on the shortlist for deep evaluation
alter table public.jobs
  add column shortlist_threshold int not null default 60 check (shortlist_threshold between 0 and 100);

-- One row per deep evaluation run (kept for audit; latest per candidate is shown)
create table public.deep_evaluations (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  score int check (score between 0 and 100),
  confidence numeric(4,3),
  disqualified boolean,
  verdict text check (verdict in ('strong', 'possible', 'weak')),
  summary text,
  strengths jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  interview_questions jsonb not null default '[]'::jsonb,
  -- [{ criterion_id, name, kind, weight, decision, confidence, evidence, sources: ["cv","form",...] }]
  results jsonb not null default '[]'::jsonb,
  -- [{ kind: "cv"|"portfolio"|"github", url, status: "read"|"failed"|"missing", note }]
  sources jsonb not null default '[]'::jsonb,
  -- what was read, for audit (CV summary by the AI, portfolio text excerpt, GitHub profile summary)
  source_snapshot jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index on public.deep_evaluations (candidate_id, created_at desc);
create index on public.deep_evaluations (job_id, status);
alter table public.deep_evaluations enable row level security;
create policy "own rows" on public.deep_evaluations for all to authenticated
  using (recruiter_id = (select auth.uid()))
  with check (recruiter_id = (select auth.uid()));

alter publication supabase_realtime add table public.deep_evaluations;
