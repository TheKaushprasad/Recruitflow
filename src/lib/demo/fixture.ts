import type { Decision, EvidenceSource } from "../types";
import type { FormRule } from "../rules";

/**
 * Sample workspace for the public guest demo. Everyone and everything here is fictional
 * (emails use the reserved example.com domain). Exact rules are re-checked in code at seed time,
 * so their results always match the rules; AI decisions below are pre-written.
 */

export const DEMO_JOB = {
  title: "Product Manager — AI Platform",
  location: "Pune · Hybrid",
  description: `We're hiring a Product Manager to own our AI platform: the models, data pipelines and internal tools that power recommendations, search and support automation for 2M+ users.

You will:
- Own the roadmap for 2–3 AI-powered product areas, from discovery to launch and iteration
- Work daily with data scientists, ML engineers and designers to turn model capabilities into features users love
- Define success metrics, run experiments, and decide what ships based on evidence
- Write clear specs, including evaluation criteria for model quality, latency and cost

You have:
- 3+ years of product management, including at least one shipped ML/AI feature
- Comfort reading model metrics (precision/recall, offline vs online evaluation) and discussing trade-offs with engineers
- A record of measurable outcomes and cross-functional leadership`,
  constraints: "Notice period of 60 days or less. Pune-based or willing to relocate. Budget up to 35 LPA.",
};

const Q_PROJECT = "Tell us about an AI or ML product or feature you shipped";
const Q_PRIO = "How do you decide what to build next? Share a recent example.";

export const DEMO_QUESTIONS: { title: string; type: "short" | "paragraph" | "dropdown" | "choice"; options?: string[]; role?: "name" | "email" | "resume" | "portfolio"; required?: boolean }[] = [
  { title: "Full name", type: "short", role: "name", required: true },
  { title: "Email", type: "short", role: "email", required: true },
  { title: "Current city", type: "short", required: true },
  { title: "Notice period", type: "dropdown", options: ["Immediate", "15 days", "30 days", "60 days", "90 days"], required: true },
  { title: "Expected CTC", type: "short", required: true },
  { title: "Years of product management experience", type: "choice", options: ["0–2 years", "3–5 years", "6–8 years", "More than 8 years"], required: true },
  { title: Q_PROJECT, type: "paragraph", required: true },
  { title: Q_PRIO, type: "paragraph", required: true },
  { title: "CV link", type: "short", role: "resume" },
  { title: "Portfolio or GitHub", type: "short", role: "portfolio" },
];

type AiKey = "city" | "ctc" | "project" | "prio";
type RuleKey = "notice" | "years" | AiKey;

const rule = (r: Partial<FormRule> & Pick<FormRule, "question" | "op" | "action">): FormRule =>
  ({ value: null, value2: null, options: [], date: null, instruction: null, ...r });

export const DEMO_RULES: { key: RuleKey; name: string; weight: number; rule: FormRule }[] = [
  { key: "notice", name: "Notice period ≤ 60 days", weight: 10,
    rule: rule({ question: "Notice period", op: "in", options: ["Immediate", "15 days", "30 days", "60 days"], action: "reject" }) },
  { key: "years", name: "3+ years in product management", weight: 15,
    rule: rule({ question: "Years of product management experience", op: "in", options: ["3–5 years", "6–8 years", "More than 8 years"], action: "reject" }) },
  { key: "city", name: "Based in Pune or relocating", weight: 10,
    rule: rule({ question: "Current city", op: "ai", action: "flag", instruction: "Lives in or near Pune, or clearly says they're willing to relocate to Pune" }) },
  { key: "ctc", name: "Expected CTC within 35 LPA", weight: 10,
    rule: rule({ question: "Expected CTC", op: "ai", action: "flag", instruction: "Expected CTC at most 35 LPA. Treat “negotiable” or no number as unclear." }) },
  { key: "project", name: "Shipped an AI/ML product", weight: 30,
    rule: rule({ question: Q_PROJECT, op: "ai_expected", action: "score",
      instruction: "Owned an AI/ML feature end to end: framed the problem, worked with data scientists on the model and its evaluation, shipped it to real users, and measured the impact with a concrete metric (conversion, accuracy, cost or time saved)." }) },
  { key: "prio", name: "Evidence-based prioritisation", weight: 20,
    rule: rule({ question: Q_PRIO, op: "ai_expected", action: "score",
      instruction: "Uses a clear method that weighs user impact, business value and effort (data, research or experiments), gives a real recent example, and explains a trade-off they made — for instance saying no to something." }) },
];

type StageTwoKey = "ownership" | "depth" | "outcomes" | "leadership" | "technical";

export const DEMO_STAGE2: { key: StageTwoKey; kind: "hard" | "soft"; name: string; description: string; weight: number; bias_flag?: string }[] = [
  { key: "ownership", kind: "hard", name: "Owned a shipped product end to end", weight: 0,
    description: "The CV or portfolio shows at least one product or major feature they owned from discovery to launch, not only supported." },
  { key: "depth", kind: "soft", name: "AI/ML product depth", weight: 35,
    description: "Worked closely with models: framing ML problems, evaluation metrics, data quality, or model trade-offs in a product role." },
  { key: "outcomes", kind: "soft", name: "Measurable outcomes", weight: 25,
    description: "Results are stated with numbers: conversion, revenue, accuracy, cost or time saved." },
  { key: "leadership", kind: "soft", name: "Cross-functional leadership", weight: 20,
    description: "Led engineers, data scientists and designers toward a shared goal; clear examples of alignment or trade-off decisions.",
    bias_flag: "Judge observable leadership behaviour only — not personality or “culture fit”, which can hide bias." },
  { key: "technical", kind: "soft", name: "Technical fluency", weight: 20,
    description: "Can discuss APIs, data pipelines or model metrics credibly; GitHub or writing samples are a plus but not required." },
];

export const DEMO_STAGES = [
  { name: "Phone screen", prompt_calendar: true },
  { name: "Onsite", prompt_calendar: true },
  { name: "Offer", prompt_calendar: false },
];

/** [decision, confidence, evidence, scored by, Jev's confidence before an OpenAI recheck] */
type AiCall = [Decision, number, string, ("jev" | "openai")?, number?];

interface DemoCandidate {
  name: string;
  email: string;
  minutesAgo: number;
  answers: { city: string; notice: string; ctc: string; years: string; project: string; prio: string };
  ai: Record<AiKey, AiCall>;
  /** The one-line "why they ranked here" (filter rejections are written automatically). */
  reason: string;
  stage2?: {
    verdict: "strong" | "possible" | "weak";
    summary: string;
    strengths: string[];
    concerns: string[];
    questions: string[];
    results: Record<StageTwoKey, [Decision, number, string, EvidenceSource[]]>;
    cvSummary: string;
  };
  pipeline?: "Phone screen" | "Onsite";
  /** Book an interview this many days from now (in the pipeline stage). */
  interviewInDays?: number;
}

export const DEMO_CANDIDATES: DemoCandidate[] = [
  {
    name: "Aditi Kulkarni", email: "aditi.kulkarni@example.com", minutesAgo: 60 * 26,
    answers: { city: "Pune (Baner)", notice: "30 days", ctc: "32 LPA", years: "6–8 years",
      project: "I led the recommendation engine revamp at a grocery app. I framed the problem with our data scientists (cold-start for new users), defined offline metrics (recall@10) and an A/B test plan, and shipped a hybrid model to 100% of users in 10 weeks. Add-to-cart from recommendations rose 14% and we cut model serving cost by 30% by batching nightly.",
      prio: "I keep a scored backlog (reach × impact × confidence ÷ effort) fed by funnel data and weekly user calls. Last quarter it showed search refinements beat a new loyalty feature on expected revenue, so I paused loyalty — unpopular with sales, but conversion rose 6%." },
    ai: { city: ["pass", 0.98, ""], ctc: ["pass", 0.96, ""], project: ["meets", 0.93, ""], prio: ["meets", 0.9, ""] },
    reason: "Shipped a recommendation system end to end with a measured +14% outcome, and prioritises with data and clear trade-offs.",
    stage2: {
      verdict: "strong",
      summary: "Six years of product management with two shipped ML products and clear, quantified outcomes; strong fit for owning the AI platform roadmap.",
      strengths: ["Shipped a recommendation system end to end with a +14% outcome", "Fluent in offline vs online evaluation", "Led a 9-person cross-functional squad"],
      concerns: ["Less exposure to LLM-based features than to classic ML"],
      questions: ["Walk us through a time your offline metrics disagreed with the A/B test — what did you ship?", "How would you set quality bars for an LLM support assistant?"],
      cvSummary: "PM at a grocery delivery app (2021–now) leading personalisation; earlier PM at a B2B SaaS analytics company.",
      results: {
        ownership: ["pass", 0.95, "CV: “Owned personalisation from discovery to launch; shipped to 1.8M users.”", ["cv"]],
        depth: ["meets", 0.92, "Defined recall@10 and a cold-start strategy with data scientists (CV and form answer).", ["cv", "form"]],
        outcomes: ["meets", 0.94, "+14% add-to-cart from recommendations; −30% serving cost.", ["cv", "form"]],
        leadership: ["meets", 0.86, "Led a squad of 4 engineers, 2 data scientists, 2 designers and an analyst.", ["cv"]],
        technical: ["borderline", 0.74, "Describes batching and evaluation well, but no code or technical writing samples.", ["form", "cv"]],
      },
    },
    pipeline: "Phone screen", interviewInDays: 2,
  },
  {
    name: "Rohan Mehta", email: "rohan.mehta@example.com", minutesAgo: 60 * 30,
    answers: { city: "Bengaluru — happy to relocate to Pune", notice: "15 days", ctc: "30 LPA", years: "3–5 years",
      project: "At a fintech I owned the rollout of a new fraud-detection model. I worked with two data scientists on the precision/recall trade-off, set up a shadow mode for 4 weeks, and launched it to all card transactions. Fraud losses fell 22% while false declines went down 9%.",
      prio: "Mostly by what leadership asks for and what support tickets say is urgent." },
    ai: { city: ["pass", 0.91, ""], ctc: ["pass", 0.95, ""], project: ["meets", 0.9, ""], prio: ["not_met", 0.8, ""] },
    reason: "Strong ML launch with careful rollout and clear metrics; the prioritisation answer is thin — worth probing on a call.",
    stage2: {
      verdict: "strong",
      summary: "Solid fintech PM with a well-run ML launch (shadow mode, precision/recall trade-offs) and measurable impact; less leadership scope than the top candidates.",
      strengths: ["Shadow-mode launch shows careful ML rollout practice", "Clear metrics: −22% fraud losses, −9% false declines"],
      concerns: ["Leadership examples are mostly within one team", "Prioritisation seems driven by others"],
      questions: ["How did you decide the precision/recall operating point with risk and business teams?", "Tell us about something you decided not to build."],
      cvSummary: "Product Manager, Risk at a payments fintech (2022–now); previously business analyst.",
      results: {
        ownership: ["pass", 0.9, "CV: “Owned fraud model v2 rollout, from scoping to 100% traffic.”", ["cv"]],
        depth: ["meets", 0.88, "Discusses the precision/recall trade-off and shadow mode.", ["form", "cv"]],
        outcomes: ["meets", 0.9, "−22% fraud losses; −9% false declines.", ["form"]],
        leadership: ["borderline", 0.72, "Coordinated risk ops and data science, but no larger team leadership shown.", ["cv"]],
        technical: ["borderline", 0.72, "A few small data-analysis notebooks on GitHub; metric fluency is good.", ["github", "cv"]],
      },
    },
  },
  {
    name: "Sneha Iyer", email: "sneha.iyer@example.com", minutesAgo: 60 * 20,
    answers: { city: "Mumbai", notice: "60 days", ctc: "26 LPA", years: "3–5 years",
      project: "I launched an AI support assistant for our e-commerce help centre using an LLM with retrieval over our FAQs. It now resolves about 30% of chats without an agent. I ran the vendor evaluation and wrote the guardrails for refunds.",
      prio: "I look at ticket volumes and CSAT each month and pick the biggest pain points with the support lead." },
    ai: {
      city: ["unclear", 0.62, "Says Mumbai with no mention of relocating to Pune — worth asking before deciding.", "openai", 0.55],
      ctc: ["pass", 0.97, ""], project: ["meets", 0.86, ""], prio: ["borderline", 0.74, ""],
    },
    reason: "Strong LLM product example with a clear 30% deflection outcome; location is the open question — Mumbai with no relocation mentioned.",
    stage2: {
      verdict: "possible",
      summary: "Relevant LLM product experience with a good outcome, but thinner ownership and leadership than the strongest candidates; location needs confirming.",
      strengths: ["Shipped an LLM assistant with retrieval — directly relevant", "30% chat deflection"],
      concerns: ["Vendor-led build; limited evidence of model evaluation work", "Relocation to Pune not confirmed"],
      questions: ["How did you measure answer quality before and after launch?", "Would you relocate to Pune, or work hybrid from there?"],
      cvSummary: "Product Manager, Customer Experience at an e-commerce company (2021–now).",
      results: {
        ownership: ["pass", 0.82, "Owned the assistant launch; CV lists vendor selection through rollout.", ["cv"]],
        depth: ["borderline", 0.7, "Retrieval setup and guardrails, but evaluation was vendor-run.", ["cv", "form"]],
        outcomes: ["meets", 0.85, "~30% of chats resolved without an agent.", ["form"]],
        leadership: ["not_met", 0.7, "Worked mainly with a vendor; no examples of leading an internal team.", ["cv"]],
        technical: ["borderline", 0.66, "No GitHub; CV mentions prompt design and retrieval at a high level.", ["cv"]],
      },
    },
  },
  {
    name: "Arjun Nair", email: "arjun.nair@example.com", minutesAgo: 60 * 44,
    answers: { city: "Pune", notice: "90 days", ctc: "34 LPA", years: "6–8 years",
      project: "I owned search ranking at a travel marketplace. With our ML team we moved from rules to a learning-to-rank model, defined NDCG as the offline metric, and shipped it after a 3-week A/B test. Bookings from search rose 11%.",
      prio: "I run opportunity sizing on every idea and review it with engineering for effort before committing." },
    ai: { city: ["pass", 0.99, ""], ctc: ["pass", 0.95, ""], project: ["meets", 0.94, ""], prio: ["meets", 0.88, ""] },
    reason: "Would rank near the top — strong search-ranking launch — but the notice period is 90 days.",
  },
  {
    name: "Priyanka Deshmukh", email: "priyanka.deshmukh@example.com", minutesAgo: 60 * 50,
    answers: { city: "Pune", notice: "Immediate", ctc: "18 LPA", years: "0–2 years",
      project: "As an associate PM I helped launch a churn-prediction dashboard for our sales team. I gathered requirements and worked with an analyst who built the model.",
      prio: "I follow the roadmap my manager sets and add ideas from customer calls." },
    ai: { city: ["pass", 0.99, ""], ctc: ["pass", 0.97, ""], project: ["borderline", 0.8, ""], prio: ["borderline", 0.8, ""] },
    reason: "Early-career (0–2 years); supported an analyst's model rather than owning an AI feature.",
  },
  {
    name: "Karan Shah", email: "karan.shah@example.com", minutesAgo: 60 * 8,
    answers: { city: "Pune", notice: "30 days", ctc: "Negotiable", years: "3–5 years",
      project: "I have worked on several AI features across our product and collaborated with the data team to improve user experience.",
      prio: "I talk to stakeholders and prioritise what seems most important." },
    ai: {
      city: ["pass", 0.98, ""],
      ctc: ["unclear", 0.6, "Wrote “Negotiable” with no number, so it can't be checked against 35 LPA.", "openai", 0.52],
      project: ["borderline", 0.66, "Relevant area, but no specific feature, role, metric or outcome is described.", "openai", 0.58],
      prio: ["borderline", 0.62, "Names a method (stakeholder input) but gives no example or trade-off.", "openai", 0.55],
    },
    reason: "Meets the basics, but both open answers are generic and the expected CTC isn't stated — a quick call would fill the gaps.",
  },
  {
    name: "Meera Pillai", email: "meera.pillai@example.com", minutesAgo: 40,
    answers: { city: "Hyderabad, willing to relocate to Pune", notice: "30 days", ctc: "34 LPA", years: "6–8 years",
      project: "I built and launched an LLM-based contract summarisation feature for a legal-tech SaaS. I defined an evaluation set of 400 contracts with lawyers, set accuracy and hallucination thresholds, and shipped to 200 law firms. Review time per contract dropped 45% and it became our top upsell.",
      prio: "We use customer advisory calls and usage data to pick themes each quarter, then size them with engineering." },
    ai: { city: ["pass", 0.94, ""], ctc: ["pass", 0.93, ""], project: ["meets", 0.95, ""], prio: ["borderline", 0.78, ""] },
    reason: "Excellent LLM launch with a rigorous evaluation set and a 45% outcome; prioritisation is sound but lacks a concrete trade-off.",
  },
  {
    name: "Vikram Joshi", email: "vikram.joshi@example.com", minutesAgo: 60 * 14,
    answers: { city: "Pune", notice: "60 days", ctc: "45 LPA", years: "More than 8 years",
      project: "Led the ML platform product at an ad-tech company: feature store, model registry and self-serve training for 40 data scientists. Cut time-to-production for models from 6 weeks to 5 days.",
      prio: "I model the time saved for data scientists per platform feature and fund the top three each quarter; I cut a custom notebook tool because the savings were too small." },
    ai: { city: ["pass", 0.99, ""], ctc: ["fail", 0.97, ""], project: ["meets", 0.92, ""], prio: ["meets", 0.9, ""] },
    reason: "Deep ML-platform experience and data-driven prioritisation — but expected CTC (45 LPA) is above the 35 LPA budget.",
  },
  {
    name: "Ananya Rao", email: "ananya.rao@example.com", minutesAgo: 60 * 5,
    answers: { city: "Pune", notice: "15 days", ctc: "28 LPA", years: "3–5 years",
      project: "I ran a large festive-season marketing campaign across app and social channels that grew daily active users by 20%.",
      prio: "I pick campaigns based on the festive calendar and last year's results." },
    ai: { city: ["pass", 0.99, ""], ctc: ["pass", 0.96, ""], project: ["not_met", 0.9, ""], prio: ["borderline", 0.76, ""] },
    reason: "Clear delivery experience, but the example is a marketing campaign rather than an AI or ML product.",
  },
  {
    name: "Farhan Qureshi", email: "farhan.qureshi@example.com", minutesAgo: 60 * 36,
    answers: { city: "Nagpur — can move to Pune", notice: "Immediate", ctc: "25 LPA", years: "3–5 years",
      project: "I was the PM for a computer-vision quality check on a manufacturing line. The model flags defective parts from camera images; we reached 92% detection and reduced manual inspection hours by a third.",
      prio: "Plant managers tell us the most costly defects, and we prioritise those." },
    ai: { city: ["pass", 0.88, ""], ctc: ["pass", 0.97, ""], project: ["borderline", 0.8, ""], prio: ["borderline", 0.72, ""] },
    reason: "Relevant computer-vision product with good results, but ownership was shared with a vendor and priorities are mostly set by others.",
    stage2: {
      verdict: "possible",
      summary: "Relevant computer-vision product with a good outcome, but ownership appears shared with the vendor and consumer-product experience is limited.",
      strengths: ["Shipped a CV model to production with 92% detection", "Available immediately"],
      concerns: ["Ownership shared with an external vendor", "No consumer or platform product experience"],
      questions: ["What did you personally decide about the model's thresholds and false positives?"],
      cvSummary: "Product Manager at an industrial-automation company (2022–now); earlier production engineer.",
      results: {
        ownership: ["pass", 0.74, "Led the QC product with a vendor; CV lists launch responsibilities.", ["cv"]],
        depth: ["borderline", 0.7, "Some work on detection thresholds; model decisions were mostly the vendor's.", ["cv", "form"]],
        outcomes: ["meets", 0.82, "92% detection; one-third fewer inspection hours.", ["form"]],
        leadership: ["borderline", 0.64, "Coordinated plant operations and a vendor team.", ["cv"]],
        technical: ["borderline", 0.62, "Engineering background, but no samples of product or data work.", ["cv"]],
      },
    },
  },
  {
    name: "Nikhil Bansal", email: "nikhil.bansal@example.com", minutesAgo: 60 * 70,
    answers: { city: "Pune (Hinjewadi)", notice: "30 days", ctc: "31 LPA", years: "6–8 years",
      project: "I led ML-based demand forecasting for a quick-commerce app. With two data scientists we replaced spreadsheet forecasts with a gradient-boosted model per store and SKU, ran a 6-city pilot, and rolled out nationally. Food waste fell 18% and stock-outs dropped 12%.",
      prio: "Every idea gets a one-page bet: expected impact on waste or stock-outs, cost, and a pilot plan. I killed a pricing experiment when the pilot showed no lift after two weeks." },
    ai: { city: ["pass", 0.99, ""], ctc: ["pass", 0.95, ""], project: ["meets", 0.94, ""], prio: ["meets", 0.92, ""] },
    reason: "Led a national ML forecasting rollout with −18% waste; prioritises with small, measurable bets and stops what doesn't work.",
    stage2: {
      verdict: "strong",
      summary: "Experienced PM with a large-scale ML launch, strong metrics and clear leadership across data science and operations.",
      strengths: ["National rollout of an ML forecasting system", "−18% waste and −12% stock-outs", "Led pilot design across 6 cities"],
      concerns: ["Mostly operations-facing ML; less end-user product work"],
      questions: ["How did you get store teams to trust the model over their spreadsheets?"],
      cvSummary: "Senior PM, Supply Chain at a quick-commerce company (2020–now).",
      results: {
        ownership: ["pass", 0.94, "Owned forecasting from pilot design to national rollout.", ["cv"]],
        depth: ["borderline", 0.76, "Clear pilot design, but model choices were led by the data science team.", ["form", "cv"]],
        outcomes: ["meets", 0.93, "−18% food waste, −12% stock-outs.", ["form", "cv"]],
        leadership: ["meets", 0.85, "Aligned data science, operations and 6 city teams.", ["cv"]],
        technical: ["meets", 0.8, "Portfolio write-up explains features and error metrics clearly.", ["portfolio"]],
      },
    },
    pipeline: "Onsite",
  },
];
