-- Two-stage rubric: stage 1 screens form answers, stage 2 reviews CV + portfolio + GitHub.
-- Existing criteria keep their current meaning (judged on form answers) and become stage 1.

alter table public.rubric_criteria
  add column stage smallint not null default 1 check (stage in (1, 2));

create index on public.rubric_criteria (rubric_id, stage);

-- The recruiter moves candidates into stage 2 by hand; that triggers the deep evaluation.
alter table public.candidates add column stage2_at timestamptz;
