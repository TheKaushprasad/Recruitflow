import "server-only";
import { google, type forms_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { Answer, FormQuestion } from "../types";

function questionItem(q: FormQuestion): forms_v1.Schema$Item {
  const required = q.required;
  switch (q.type) {
    case "paragraph":
      return { title: q.title, questionItem: { question: { required, textQuestion: { paragraph: true } } } };
    case "choice":
    case "dropdown":
    case "checkbox":
      return {
        title: q.title,
        questionItem: {
          question: {
            required,
            choiceQuestion: {
              type: q.type === "choice" ? "RADIO" : q.type === "dropdown" ? "DROP_DOWN" : "CHECKBOX",
              options: (q.options.length ? q.options : ["Option 1"]).map((value) => ({ value })),
            },
          },
        },
      };
    case "date":
      return { title: q.title, questionItem: { question: { required, dateQuestion: {} } } };
    default:
      return { title: q.title, questionItem: { question: { required, textQuestion: { paragraph: false } } } };
  }
}

/**
 * Creates the form (or replaces all its questions) and publishes it.
 * Note: the Forms API cannot link a response Sheet (linkedSheetId is output-only),
 * so responses for in-app forms are read with forms.responses.list instead.
 */
export async function upsertForm(
  auth: OAuth2Client,
  opts: { formId: string | null; title: string; description: string; questions: FormQuestion[] },
) {
  const forms = google.forms({ version: "v1", auth });
  let formId = opts.formId;
  if (!formId) {
    const created = await forms.forms.create({
      requestBody: { info: { title: opts.title, documentTitle: opts.title } },
    });
    formId = created.data.formId!;
  }

  const current = await forms.forms.get({ formId });
  const existing = current.data.items ?? [];
  const requests: forms_v1.Schema$Request[] = [
    {
      updateFormInfo: {
        info: { title: opts.title, description: opts.description },
        updateMask: "title,description",
      },
    },
    // delete from the end so indexes stay valid
    ...existing.map((_, i) => ({ deleteItem: { location: { index: existing.length - 1 - i } } })),
    ...opts.questions.map((q, index) => ({ createItem: { item: questionItem(q), location: { index } } })),
  ];
  const res = await forms.forms.batchUpdate({
    formId,
    requestBody: { requests, includeFormInResponse: true },
  });

  // Forms created through the API start unpublished.
  try {
    await forms.forms.setPublishSettings({
      formId,
      requestBody: {
        publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
        updateMask: "publish_state",
      },
    });
  } catch {
    // Legacy forms have no publish settings and are already live.
  }

  const items = res.data.form?.items ?? [];
  return {
    formId,
    responderUri: res.data.form?.responderUri ?? current.data.responderUri ?? null,
    itemIds: opts.questions.map(
      (_, i) => items[i]?.questionItem?.question?.questionId ?? null,
    ),
  };
}

/** Opens or closes a form for new responses (the form stays published). */
export async function setAcceptingResponses(auth: OAuth2Client, formId: string, accepting: boolean) {
  const forms = google.forms({ version: "v1", auth });
  await forms.forms.setPublishSettings({
    formId,
    requestBody: {
      publishSettings: { publishState: { isPublished: true, isAcceptingResponses: accepting } },
      updateMask: "publish_state",
    },
  });
}

export interface RawResponse {
  externalId: string;
  submittedAt: string | null;
  email: string | null;
  answers: Answer[];
}

/** Responses to an in-app form, with answers keyed by question title. */
export async function listResponses(
  auth: OAuth2Client,
  formId: string,
  since?: string | null,
): Promise<RawResponse[]> {
  const forms = google.forms({ version: "v1", auth });
  const form = await forms.forms.get({ formId });
  const titles = new Map<string, string>();
  for (const it of form.data.items ?? []) {
    const qid = it.questionItem?.question?.questionId;
    if (qid) titles.set(qid, it.title ?? qid);
  }

  const out: RawResponse[] = [];
  let pageToken: string | undefined;
  do {
    const res = await forms.forms.responses.list({
      formId,
      pageToken,
      filter: since ? `timestamp > ${since}` : undefined,
    });
    for (const r of res.data.responses ?? []) {
      const answers: Answer[] = [];
      for (const [qid, a] of Object.entries(r.answers ?? {})) {
        const text = a.textAnswers?.answers
          ? a.textAnswers.answers.map((x) => x.value).filter(Boolean).join(", ")
          : (a.fileUploadAnswers?.answers ?? [])
              .map((f) => `https://drive.google.com/file/d/${f.fileId}`)
              .join(", ");
        answers.push({ question: titles.get(qid) ?? qid, answer: text });
      }
      out.push({
        externalId: r.responseId!,
        submittedAt: r.lastSubmittedTime ?? r.createTime ?? null,
        email: r.respondentEmail ?? null,
        answers,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}
