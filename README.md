# recruitflow

Rubric-based candidate screening. A recruiter links a job description to a Google Form. Every applicant is scored against one rubric, criterion by criterion, with evidence for each decision. Candidates then move through an interview pipeline, and invites and emails go out from the recruiter's own Google account.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, RLS, Realtime) · OpenAI or Claude (rubric drafting, rechecks, evidence, CV review — set with `AI_PROVIDER`) · Jev by TypeSafe AI (per-criterion decisions) · Google Forms / Sheets / Gmail / Calendar APIs.

## How screening works

1. **Rubric.** The AI turns the job description and your constraints into a rubric with three kinds of item:
   - **Form rules:** exact checks on a form answer, e.g. years of experience at least 3, or notice period one of Immediate…60 days. Each rule rejects, flags for review, or adds to the score. The AI suggests them from your constraints and maps each one to the right form question; you edit or approve them.
   - **AI-judged filters:** constraints that can't be read from a single field.
   - **Scored criteria:** weighted skills from the JD.

   Each rubric version is stored, and approved versions are locked, so every score can be traced back to its version.
2. **Ingest.** New responses are pulled every few minutes, whenever you open a job, or straight away with **Sync now**.
3. **Stage 1a: form rules (every applicant, instant, no AI).** Failing a "reject" rule stops the candidate here, so no AI cost is spent on them. Blank or unreadable answers are flagged for review, never rejected.
4. **Stage 1b: AI screening of form answers.** Jev decides each criterion with a calibrated confidence. Anything below the threshold (0.70 by default) is rechecked by the AI, which also writes the evidence for every decision. If only rules or weights changed between rubric versions, earlier AI results are reused, so the rescoring costs nothing.
5. **Shortlist.** A stage-1 score at or above the job's cut-off (60 by default), or a "needs review" flag, marks the candidate as Shortlisted.
6. **Stage 2: deep evaluation (when you click Evaluate).** The AI reads the JD, the CV (PDF, Google Drive/Docs, Dropbox), the form answers, the portfolio site and the GitHub profile together. Form rules are passed in as fixed facts. You get a suitability score, a verdict, strengths, concerns, per-criterion evidence tagged by source, and interview questions.
7. **Scoring maths.** The score is the weighted share of criteria and score-rules met; borderline or unclear counts as half. Failing a hard filter or a reject-rule disqualifies the candidate, and this is shown separately.

## Setup

### 1. Supabase
1. Create a project. In the SQL editor, run every file in `supabase/migrations/` in order (`0001_init.sql` … `0006_form_rules.sql`).
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
- **Close / reopen:** use the button at the top right of any job. Closing stops syncing and scoring, and switches off responses on the Google Form when recruitflow can reach it. Candidates, scores, emails and interviews all stay available.
- **History:** **Jobs → Closed** lists past jobs and their closing dates. Each job's **Rubric** tab lists every version, with how many candidates were scored on it. **Emails** can be filtered by job, and each job's overview links to its email history.
- **Delete:** at the bottom of **Job setup**, type the job title to confirm. This permanently removes the job's data in recruitflow. Your Google Form, Sheet, sent emails and calendar events are left untouched.

## Differences from the PRD
- **In-app forms can't auto-link a response Sheet.** The Forms API exposes `linkedSheetId` as read-only. recruitflow reads those responses through the Forms API instead. **Export to Sheet** writes ranked results to a new spreadsheet (or to the linked Sheet for linked forms).
- **No n8n.** Orchestration (ingest → Jev → Claude → Supabase) runs inside the app, triggered by `/api/cron`.
- **Resume files aren't read.** Candidates paste a resume link, which is shown for context only.
- **Emails only go out on your confirmation.** They're sent from your Gmail, and every send is logged.

## Tests
```bash
npm test
```
