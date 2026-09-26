-- Allow OpenAI as the AI that drafts rubrics and reviews candidates (alongside Claude)

alter table public.rubrics drop constraint rubrics_source_check;
alter table public.rubrics
  add constraint rubrics_source_check check (source in ('claude', 'openai', 'recruiter'));

alter table public.criterion_results drop constraint criterion_results_scored_by_check;
alter table public.criterion_results
  add constraint criterion_results_scored_by_check check (scored_by in ('jev', 'claude', 'openai'));
