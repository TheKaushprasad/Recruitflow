# reqroot

Rubric-based candidate screening. A recruiter links a job description to a Google Form. Every applicant is scored against one rubric, criterion by criterion, with evidence for each decision. Candidates then move through an interview pipeline, and invites and emails go out from the recruiter's own Google account.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, RLS, Realtime) · OpenAI (rubric drafting, stage-1 rechecks, stage-2 CV review) · Jev by TypeSafe AI (stage-1 decisions) · Google Forms / Sheets / Gmail / Calendar APIs.

## How screening works

The rubric has two stages, each with full add / edit / delete on the **Rubric** tab. Each stage can be drafted by OpenAI. Every rubric version is stored, and approved versions are locked, so every result can be traced back to its version.

1. **Stage 1 · Form screening (every applicant, automatic).**
   - **Filters on form answers.** Each form question worth screening on (location, experience, expected CTC, notice period…) is offered as a filter.
     - Structured answers (dropdowns, numbers, dates) are checked exactly in code.
     - Free-text answers ("Bangalore / BLR", "12L", "12,00,000") get an **AI check** against a requirement you write in plain words.
     - Each filter rejects, flags for review, or adds points. Blank or unclear answers are flagged, never rejected.
     - Failing an exact reject-filter stops the candidate before any AI cost.
   - **Open-ended questions** ("Tell us about a project…") are graded by AI against an **expected answer**. You write it, or click **Generate from JD with AI**. It's a yardstick for relevance and substance, not a checklist, so short but specific answers can meet it.
   - Every check earns points when met, and together they make the stage-1 score.
   - **How AI items are judged:** Jev decides first, OpenAI rechecks anything under the confidence threshold (0.70 by default) and writes the evidence. Unchanged AI items are reused across rubric versions, so editing filters, weights or stage 2 re-applies instantly and for free.
2. **You decide who moves on.** Based on the stage-1 score and reasons, click **Move to stage 2**, for one candidate or up to 10 at a time.
3. **Stage 2 · CV, portfolio and GitHub review (starts on the move).**
   - OpenAI judges the stage-2 rubric's criteria and must-haves using the JD together with the CV (PDF, Google Drive/Docs, Dropbox), form answers, portfolio site and GitHub profile. Stage-1 results are passed in as context.
   - You get a suitability score, a verdict, strengths, concerns, per-criterion evidence tagged by source, and interview questions.
4. **Scoring maths.** A stage's score is the weighted share of its criteria (and points-filters) met; borderline or unclear counts as half. Failing a reject-filter or a must-have disqualifies the candidate, and this is shown separately.

## Setup

### 1. Supabase
1. Create a project. In the SQL editor, run every file in `supabase/migrations/` in order (`0001_init.sql` … `0007_two_stage_rubric.sql`).
2. Go to **Authentication → URL configuration** and set Site URL to your `APP_URL`. Add `APP_URL/auth/callback` as a redirect URL.
3. Optional: under **Authentication → Providers**, enable Google sign-in. This is only for logging in; the Google data connection is set up separately (next section).

### 2. Google Cloud
1. Enable these APIs: **Google Forms API, Google Sheets API, Gmail API, Google Calendar API**.
2. Configure the OAuth consent screen and add these scopes: `forms.body`, `forms.responses.readonly`, `spreadsheets`, `gmail.send`, `calendar.events`, `calendar.freebusy`. While the app is in *Testing*, add yourself as a test user.
3. Create an **OAuth client ID** of type Web application, with redirect URI `APP_URL/auth/google/callback`.

### 3. Environment
```bash
cp .env.example .env.local
```
Fill in every value. The Supabase keys are under **Project Settings → API**. For `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET`, generate two different values with `openssl rand -base64 32`.

### 4. Run
```bash
npm install
npm run dev
```
Sign in, open **Integrations → Connect Google**, then create a job.

### 5. Scheduler
`GET /api/cron` with header `Authorization: Bearer $CRON_SECRET` syncs responses and scores pending candidates for every job.
- **Vercel:** `vercel.json` schedules it once a day (00:30 UTC), which is the most often the free Hobby plan allows; more frequent schedules make Hobby deploys fail. Vercel sends `CRON_SECRET` automatically once it's set as a project env var. Responses are also pulled whenever a recruiter opens a job, and immediately with **Sync now**. On Pro, change the schedule to `*/5 * * * *` for 5-minute syncing, or keep Hobby and add an external scheduler (below).
- **Elsewhere:** call the endpoint on a schedule from Supabase `pg_cron` + `pg_net`, cron-job.org, or a similar service.

## Managing jobs
- **New job:** on **Jobs**, fill in the title and click **Create job**. Under **Start from**, you can pick any past or current job and choose what to copy: description and constraints, form questions, pipeline stages, and the approved rubric. As you type a title, related past jobs are suggested. A copied rubric arrives as a draft, so you still review it before scoring. The new job always gets its own Google Form and starts with no candidates.
- **Create similar job:** available on every job's header and in its **Related jobs** section.
- **Related jobs:** each job's overview lists jobs that share its template or have a similar title, with applicants, qualified count, average score, how many reached the final stage, and interviews.
- **History tab:** a dated timeline for each job. It covers creation (and which job it was based on), form changes, rubric versions and approvals, applications per day, pipeline moves, interviews, emails, and closing or reopening. Filter by type.
- **Close / reopen:** use the button at the top right of any job. Closing stops syncing and scoring, and switches off responses on the Google Form when reqroot can reach it. Candidates, scores, emails and interviews all stay available.
- **History:** **Jobs → Closed** lists past jobs and their closing dates. Each job's **Rubric** tab lists every version, with how many candidates were scored on it. **Emails** can be filtered by job, and each job's overview links to its email history.
- **Delete:** at the bottom of **Job setup**, type the job title to confirm. This permanently removes the job's data in reqroot. Your Google Form, Sheet, sent emails and calendar events are left untouched.

## Differences from the PRD
- **In-app forms can't auto-link a response Sheet.** The Forms API exposes `linkedSheetId` as read-only. reqroot reads those responses through the Forms API instead. **Export to Sheet** writes ranked results to a new spreadsheet (or to the linked Sheet for linked forms).
- **No n8n.** Orchestration (ingest → Jev → OpenAI → Supabase) runs inside the app, triggered by `/api/cron`.
- **OpenAI instead of Claude.** OpenAI drafts the rubric and does the rechecks and CV reviews.
- **Resume files aren't read.** Candidates paste a resume link, which is shown for context only.
- **Emails only go out on your confirmation.** They're sent from your Gmail, and every send is logged.

## Tests
```bash
npm test
```
