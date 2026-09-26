-- Stage-1 filters now earn points when passed (default 10). Earlier filters were saved with
-- 0 points under the old rules, so give them the new default. Safe to run more than once.
update public.rubric_criteria
set weight = 10
where kind = 'rule' and stage = 1 and weight = 0;
