import type { FormRule } from "./rules";

export type FormSource = "built" | "linked";

export interface Job {
  id: string;
  recruiter_id: string;
  title: string;
  location: string;
  description: string;
  constraints: string;
  form_source: FormSource;
  google_form_id: string | null;
  google_form_url: string | null;
  sheet_id: string | null;
  sheet_range: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  recheck_threshold: number;
  require_signoff: boolean;
  current_rubric_id: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  based_on_job_id: string | null;
  shortlist_threshold: number;
  created_at: string;
}

export type RubricStatus = "draft" | "approved" | "superseded";

export interface Rubric {
  id: string;
  recruiter_id: string;
  job_id: string;
  version: number;
  status: RubricStatus;
  bias_reviewed: boolean;
  source: "claude" | "openai" | "recruiter";
  model: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface Criterion {
  id: string;
  recruiter_id: string;
  rubric_id: string;
  position: number;
  /** hard = AI-judged filter, soft = AI-scored criterion, rule = exact check on a form answer */
  kind: CriterionKind;
  name: string;
  description: string;
  weight: number;
  source_constraint: string | null;
  bias_flag: string | null;
  enabled: boolean;
  rule: FormRule | null;
  /** 1 = form screening, 2 = CV / portfolio / GitHub review */
  stage: 1 | 2;
}

export type CriterionKind = "hard" | "soft" | "rule";

export type QuestionType = "short" | "paragraph" | "choice" | "dropdown" | "checkbox" | "date";
export type QuestionRole = "name" | "email" | "resume" | "portfolio" | "github";

export interface FormQuestion {
  id: string;
  job_id: string;
  position: number;
  title: string;
  type: QuestionType;
  required: boolean;
  options: string[];
  role: QuestionRole | null;
  google_item_id: string | null;
}

export interface Stage {
  id: string;
  job_id: string;
  name: string;
  position: number;
  prompt_calendar: boolean;
}

export interface Answer {
  question: string;
  answer: string;
}

export interface Candidate {
  id: string;
  recruiter_id: string;
  job_id: string;
  external_id: string;
  name: string;
  email: string | null;
  resume_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  /** when the recruiter moved them to stage 2 (CV review); null = still in stage 1 */
  stage2_at: string | null;
  answers: Answer[];
  submitted_at: string | null;
  stage_id: string | null;
  score_status: "pending" | "scoring" | "scored" | "error";
  score_error: string | null;
  /** Failed scoring attempts so far; retried automatically up to MAX_ATTEMPTS. */
  score_attempts?: number;
  next_attempt_at?: string | null;
  created_at: string;
}

export type Decision = "meets" | "borderline" | "not_met" | "pass" | "fail" | "unclear";

export type EvidenceSource = "form" | "cv" | "portfolio" | "github";

export interface DeepResult {
  criterion_id: string;
  name: string;
  kind: CriterionKind;
  /** for rules: what failing it does */
  action?: "reject" | "flag" | "score";
  weight: number;
  decision: Decision;
  confidence: number;
  evidence: string;
  sources: EvidenceSource[];
}

export interface DeepSource {
  kind: "cv" | "portfolio" | "github";
  url: string | null;
  status: "read" | "failed" | "missing";
  note: string;
}

export interface DeepEvaluation {
  id: string;
  job_id: string;
  candidate_id: string;
  rubric_id: string;
  status: "queued" | "running" | "done" | "error";
  attempts?: number;
  next_attempt_at?: string | null;
  score: number | null;
  confidence: number | null;
  disqualified: boolean | null;
  verdict: "strong" | "possible" | "weak" | null;
  summary: string | null;
  strengths: string[];
  concerns: string[];
  interview_questions: string[];
  results: DeepResult[];
  sources: DeepSource[];
  source_snapshot: { cv_summary?: string; portfolio_excerpt?: string; github_summary?: string };
  provider: string | null;
  model: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface CriterionResult {
  id: string;
  evaluation_id: string;
  criterion_id: string;
  decision: Decision;
  confidence: number;
  evidence: string;
  /** "rule" = exact check in code; jev / openai (or legacy claude) = AI-judged */
  scored_by: "jev" | "claude" | "openai" | "rule";
  initial_confidence: number | null;
  probabilities: Record<string, number> | null;
}

export interface Evaluation {
  id: string;
  candidate_id: string;
  rubric_id: string;
  score: number;
  confidence: number;
  disqualified: boolean;
  needs_review: boolean;
  reason: string;
  created_at: string;
}

export interface Interview {
  id: string;
  job_id: string;
  candidate_id: string;
  stage_id: string | null;
  starts_at: string;
  duration_min: number;
  attendees: string[];
  google_event_id: string | null;
  meet_url: string | null;
  html_link: string | null;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface EmailSend {
  id: string;
  job_id: string | null;
  candidate_id: string | null;
  to_email: string;
  subject: string;
  status: "sent" | "failed";
  error: string | null;
  sent_at: string;
}
