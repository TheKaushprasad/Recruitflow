-- Form rules: HR-defined checks on form answers, applied exactly in code.
-- Stored as rubric criteria of kind 'rule', so they're versioned and approved with the rubric.

alter table public.rubric_criteria drop constraint rubric_criteria_kind_check;
alter table public.rubric_criteria
  add constraint rubric_criteria_kind_check check (kind in ('hard', 'soft', 'rule'));

-- { question, op, value, value2, options, date, action: 'reject' | 'flag' | 'score' }
alter table public.rubric_criteria add column rule jsonb;

alter table public.rubric_criteria
  add constraint rubric_criteria_rule_shape check ((kind = 'rule') = (rule is not null));

-- Rule results are stored alongside AI results, marked as checked by a rule
alter table public.criterion_results drop constraint criterion_results_scored_by_check;
alter table public.criterion_results
  add constraint criterion_results_scored_by_check check (scored_by in ('jev', 'claude', 'openai', 'rule'));
