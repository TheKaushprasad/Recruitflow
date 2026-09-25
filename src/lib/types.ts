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
  source: "claude" | "recruiter";
  model: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface Criterion {
  id: string;
  recruiter_id: string;
  rubric_id: string;
  position: number;
  kind: "hard" | "soft";
  name: string;
  description: string;
  weight: number;
  source_constraint: string | null;
  bias_flag: string | null;
  enabled: boolean;
}

export type QuestionType = "short" | "paragraph" | "choice" | "dropdown" | "checkbox" | "date";

export interface FormQuestion {
  id: string;
  job_id: string;
  position: number;
  title: string;
  type: QuestionType;
  required: boolean;
  options: string[];
  role: "name" | "email" | "resume" | null;
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
  answers: Answer[];
  submitted_at: string | null;
  stage_id: string | null;
  score_status: "pending" | "scoring" | "scored" | "error";
  score_error: string | null;
  created_at: string;
}

export type Decision = "meets" | "borderline" | "not_met" | "pass" | "fail" | "unclear";

export interface CriterionResult {
  id: string;
  evaluation_id: string;
  criterion_id: string;
  decision: Decision;
  confidence: number;
  evidence: string;
  scored_by: "jev" | "claude";
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
