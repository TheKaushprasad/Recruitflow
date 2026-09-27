-- 0009: background scoring queue (claims + automatic retries) and AI usage / monthly budget.

-- ---------- queue columns ----------
alter table public.candidates
  add column if not exists score_attempts int not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz;
create index if not exists candidates_queue_idx on public.candidates (score_status, next_attempt_at);

alter table public.deep_evaluations
  add column if not exists attempts int not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz;

-- Candidates marked "scored" on an older rubric version go back in the queue once.
update public.candidates c set score_status = 'pending'
from public.jobs j
where j.id = c.job_id and j.current_rubric_id is not null and c.score_status = 'scored'
  and not exists (select 1 from public.evaluations e where e.candidate_id = c.id and e.rubric_id = j.current_rubric_id);

-- ---------- atomic claims (service role only) ----------
-- Several workers can run at once (the every-minute scheduler, "Sync now", a rubric approval);
-- SKIP LOCKED guarantees each candidate is scored by exactly one of them. A claim older than
-- 10 minutes is treated as abandoned (the function timed out) and can be claimed again.
create or replace function public.claim_scoring(p_limit int, p_job uuid default null, p_exclude uuid[] default '{}')
returns setof public.candidates
language sql security definer set search_path = public as $$
  update public.candidates c
     set score_status = 'scoring', claimed_at = now()
   where c.id in (
     select c2.id
       from public.candidates c2
       join public.jobs j on j.id = c2.job_id
      where j.status = 'open'
        and j.current_rubric_id is not null
        and (p_job is null or c2.job_id = p_job)
        and not (c2.recruiter_id = any (p_exclude))
        and (
          (c2.score_status = 'pending' and (c2.next_attempt_at is null or c2.next_attempt_at <= now()))
          or (c2.score_status = 'scoring' and coalesce(c2.claimed_at, c2.created_at) < now() - interval '10 minutes')
        )
      order by c2.created_at
      limit p_limit
      for update of c2 skip locked
   )
  returning c.*;
$$;

create or replace function public.claim_deep(p_limit int, p_ids uuid[] default null, p_exclude uuid[] default '{}')
returns setof public.deep_evaluations
language sql security definer set search_path = public as $$
  update public.deep_evaluations d
     set status = 'running', claimed_at = now(), error = null
   where d.id in (
     select d2.id
       from public.deep_evaluations d2
      where (p_ids is null or d2.id = any (p_ids))
        and not (d2.recruiter_id = any (p_exclude))
        and (
          (d2.status = 'queued' and (d2.next_attempt_at is null or d2.next_attempt_at <= now()))
          or (d2.status = 'running' and coalesce(d2.claimed_at, d2.created_at) < now() - interval '10 minutes')
        )
      order by d2.created_at
      limit p_limit
      for update of d2 skip locked
   )
  returning d.*;
$$;

revoke execute on function public.claim_scoring(int, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.claim_deep(int, uuid[], uuid[]) from public, anon, authenticated;

-- ---------- AI usage log ----------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  provider text not null,              -- 'openai' | 'jev'
  model text not null,
  purpose text not null,               -- 'stage1' | 'stage1_explain' | 'stage2' | 'rubric'
  input_tokens int not null default 0,
  cached_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6),             -- null when the model's price isn't known
  estimated boolean not null default false, -- token counts estimated (Jev doesn't report usage)
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_recruiter_time_idx on public.ai_usage (recruiter_id, created_at);
alter table public.ai_usage enable row level security;
-- Recruiters can read their own usage; only the server (service role) writes it.
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (recruiter_id = (select auth.uid()));

-- Spend since a point in time (the budget check runs this every worker tick).
-- Runs with the caller's rights, so a signed-in recruiter only ever sums their own rows (RLS).
create or replace function public.ai_spend_since(p_recruiter uuid, p_since timestamptz)
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage where recruiter_id = p_recruiter and created_at >= p_since;
$$;
revoke execute on function public.ai_spend_since(uuid, timestamptz) from public, anon;
grant execute on function public.ai_spend_since(uuid, timestamptz) to authenticated;

-- Usage grouped for the Integrations page (the signed-in recruiter's rows only, via RLS).
create or replace function public.ai_usage_summary(p_since timestamptz)
returns table (purpose text, provider text, model text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric, estimated boolean)
language sql stable security invoker set search_path = public as $$
  select purpose, provider, model, count(*), sum(input_tokens), sum(output_tokens), sum(cost_usd), bool_or(estimated)
    from public.ai_usage
   where created_at >= p_since
   group by purpose, provider, model
   order by sum(cost_usd) desc nulls last;
$$;
revoke execute on function public.ai_usage_summary(timestamptz) from public, anon;
grant execute on function public.ai_usage_summary(timestamptz) to authenticated;

-- ---------- per-recruiter settings (monthly AI budget) ----------
create table if not exists public.recruiter_settings (
  recruiter_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_ai_budget_usd numeric(10, 2) check (monthly_ai_budget_usd is null or monthly_ai_budget_usd >= 0),
  updated_at timestamptz not null default now()
);
alter table public.recruiter_settings enable row level security;
drop policy if exists "own rows" on public.recruiter_settings;
create policy "own rows" on public.recruiter_settings for all
  using (recruiter_id = (select auth.uid())) with check (recruiter_id = (select auth.uid()));
