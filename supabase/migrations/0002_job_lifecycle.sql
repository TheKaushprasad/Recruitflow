-- Job open/closed lifecycle + per-job email history

alter table public.jobs
  add column status text not null default 'open' check (status in ('open', 'closed')),
  add column closed_at timestamptz;

create index on public.jobs (recruiter_id, status);

alter table public.email_sends
  add column job_id uuid references public.jobs(id) on delete set null;

-- Backfill from the candidate each email was sent to
update public.email_sends s
set job_id = c.job_id
from public.candidates c
where s.candidate_id = c.id and s.job_id is null;

create index on public.email_sends (job_id, sent_at desc);
