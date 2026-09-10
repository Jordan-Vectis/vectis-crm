// 📝 Hub feedback surveys — the shared shapes, safe to import from client components
// (lib/feedback.ts holds the server half).
//
// Jordan, 2026-09-10: ask the cataloguers written questions about the Hub — including
// what features they'd like — as a popup on the tablets. Written answers only (his
// choice). Named, not anonymous, so a feature request can be followed up. Each survey
// picks its own audience: roles and/or named people. "Fill it out later" keeps what
// they've typed and puts a temporary button in their top bar instead of popping up again.

export type FeedbackQuestion = { id: string; text: string }

export type SurveyStatus = "DRAFT" | "OPEN" | "CLOSED"

/** LATER = pressed "Fill it out later" (draft kept, top-bar button shown) · SUBMITTED = done. */
export type ResponseStatus = "LATER" | "SUBMITTED"

/** An answer stored WITH the wording of the question it answered, so editing a question after
 *  the survey has gone out never changes what somebody was asked. */
export type AnswerSnapshot = { questionId: string; question: string; answer: string }

/** What a person's popup, or their top-bar button, needs. */
export type SurveyForUser = {
  id: string
  title: string
  intro: string | null
  questions: FeedbackQuestion[]
  /** What they had typed when they pressed "Fill it out later", by question id. */
  draft: Record<string, string>
}

/** GET /api/feedback/mine */
export type MySurveys = {
  /** The survey to pop up now: the oldest open one they're in the audience for and have never answered or put off. */
  popup: SurveyForUser | null
  /** Surveys they put off — these drive the temporary top-bar button. */
  later: SurveyForUser[]
}

/** Every new survey starts with this as its last question (editable, removable). */
export const FEATURE_QUESTION_TEXT =
  "Is there anything you'd like the Hub to do that it doesn't do yet? Tell us about any feature you'd like."

export const MAX_QUESTIONS = 30
export const MAX_QUESTION_CHARS = 500
export const MAX_ANSWER_CHARS = 5000

/** A short random id for a new question — unique within its survey. */
export function newQuestionId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
