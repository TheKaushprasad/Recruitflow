-- Lineage: which job a new job was created from (for "related jobs" and copying setup)

alter table public.jobs
  add column based_on_job_id uuid references public.jobs(id) on delete set null;

create index on public.jobs (based_on_job_id);

-- Pipeline move log, for each job's History tab
create table public.stage_moves (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  from_stage text,   -- stage names at the time of the move (stages can be renamed later)
  to_stage text,
  moved_at timestamptz not null default now()
);
create index on public.stage_moves (job_id, moved_at desc);
alter table public.stage_moves enable row level security;
create policy "own rows" on public.stage_moves for all to authenticated
  using (recruiter_id = (select auth.uid()))
  with check (recruiter_id = (select auth.uid()));

-- Job-level events (closed, reopened, form published / linked), for the History tab
create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('closed', 'reopened', 'form_published', 'form_updated', 'form_linked')),
  detail text,
  at timestamptz not null default now()
);
create index on public.job_events (job_id, at desc);
alter table public.job_events enable row level security;
create policy "own rows" on public.job_events for all to authenticated
  using (recruiter_id = (select auth.uid()))
  with check (recruiter_id = (select auth.uid()));
