import { prisma } from "@/lib/prisma"
import type { AnswerSnapshot, FeedbackQuestion, MySurveys, SurveyForUser } from "@/lib/feedback-types"
import { MAX_ANSWER_CHARS, MAX_QUESTION_CHARS, MAX_QUESTIONS } from "@/lib/feedback-types"

// 📝 Hub feedback surveys — the server half (shapes and rules in lib/feedback-types.ts).
//
// ⚠ Migration-safe: before Run Migrations creates the tables, surveysForUser answers
// "nothing to show" rather than throwing — it runs on every page load for everyone.

/** The stored question list, cleaned: never trust a Json column's shape. */
export function parseQuestions(raw: unknown): FeedbackQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((q): q is { id: unknown; text: unknown } => !!q && typeof q === "object")
    .map(q => ({ id: String(q.id ?? "").slice(0, 40), text: String(q.text ?? "").trim().slice(0, MAX_QUESTION_CHARS) }))
    .filter(q => q.id && q.text)
    .slice(0, MAX_QUESTIONS)
}

/** The stored answers, cleaned. */
export function parseAnswers(raw: unknown): AnswerSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map(a => ({
      questionId: String(a.questionId ?? ""),
      question: String(a.question ?? ""),
      answer: String(a.answer ?? "").slice(0, MAX_ANSWER_CHARS),
    }))
    .filter(a => a.questionId)
}

/** Answers from the client (questionId → text), matched to the survey's CURRENT questions and
 *  stored with their wording. Unknown ids are dropped; answers are trimmed and capped. */
export function snapshotAnswers(questions: FeedbackQuestion[], given: unknown): AnswerSnapshot[] {
  const map = given && typeof given === "object" ? (given as Record<string, unknown>) : {}
  return questions.map(q => ({ questionId: q.id, question: q.text, answer: String(map[q.id] ?? "").trim().slice(0, MAX_ANSWER_CHARS) }))
}

/** Is this person in the survey's audience? Role match OR named. */
export function inAudience(s: { audienceRoles: string[]; audienceUserIds: string[] }, u: { id: string; role: string }): boolean {
  return s.audienceRoles.includes(u.role) || s.audienceUserIds.includes(u.id)
}

/** The survey to pop up for this person, and the ones they put off. `u.role` must come from the
 *  database, not the session — a token can be hours old. */
export async function surveysForUser(u: { id: string; role: string }): Promise<MySurveys> {
  try {
    const open = await prisma.feedbackSurvey.findMany({
      where: { status: "OPEN" },
      orderBy: [{ openedAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, intro: true, questions: true, audienceRoles: true, audienceUserIds: true },
    })
    const mine = open.filter(s => inAudience(s, u))
    if (!mine.length) return { popup: null, later: [] }

    const responses = await prisma.feedbackResponse.findMany({
      where: { userId: u.id, surveyId: { in: mine.map(s => s.id) } },
      select: { surveyId: true, status: true, answers: true },
    })
    const byId = new Map(responses.map(r => [r.surveyId, r]))
    const view = (s: (typeof mine)[number]): SurveyForUser => ({
      id: s.id,
      title: s.title,
      intro: s.intro,
      questions: parseQuestions(s.questions),
      draft: Object.fromEntries(parseAnswers(byId.get(s.id)?.answers).map(a => [a.questionId, a.answer])),
    })
    const fresh = mine.filter(s => !byId.has(s.id) && parseQuestions(s.questions).length > 0)
    const later = mine.filter(s => byId.get(s.id)?.status === "LATER")
    return { popup: fresh[0] ? view(fresh[0]) : null, later: later.map(view) }
  } catch {
    return { popup: null, later: [] }
  }
}
