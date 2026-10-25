import { z } from 'zod';
import type { Turn } from './schema';
export const writingMessageSchema = z.object({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(2000).nullable(),
});
export const writingFeedbackSchema = z.object({
  turnId: z.string(),
  corrected: z.string().trim().min(1).max(6000),
  corrections: z
    .array(
      z.object({
        original: z.string().min(1).max(2000),
        corrected: z.string().min(1).max(6000),
        explanation: z.string().min(1).max(1500),
        kind: z.enum(['correction', 'optional']),
      }),
    )
    .max(30),
});
export const writingReviewSchema = z.object({
  messages: z.array(writingFeedbackSchema).min(1).max(30),
});
export type WritingFeedback = z.infer<typeof writingFeedbackSchema>;
export type WritingReview = z.infer<typeof writingReviewSchema>;
export type WritingChat = {
  id: string;
  topic: string;
  status: 'active' | 'ended';
  created_at: string;
  review: WritingReview | null;
};
export type WritingThread = {
  chat: WritingChat;
  turns: Turn[];
  pending: { requestId: string; text: string | null } | null;
};
export function validateWritingReview(review: WritingReview, turns: Turn[]) {
  const users = turns.filter((t) => t.role === 'user');
  if (
    review.messages.length !== users.length ||
    new Set(review.messages.map((m) => m.turnId)).size !== users.length
  )
    throw new Error('Review must cover every learner message exactly once.');
  for (const message of review.messages) {
    const turn = users.find((t) => t.id === message.turnId);
    if (!turn || message.corrections.some((c) => !turn.text.includes(c.original)))
      throw new Error('Review quotation does not match your writing.');
    if (!message.corrections.length && message.corrected !== turn.text)
      throw new Error('An edited message needs an explanation.');
    const edits = message.corrections
      .map((c) => {
        const start = turn.text.indexOf(c.original);
        if (start !== turn.text.lastIndexOf(c.original))
          throw new Error('Quote more context to identify this correction.');
        return { start, end: start + c.original.length, replacement: c.corrected };
      })
      .sort((a, b) => a.start - b.start);
    let position = 0,
      corrected = '';
    for (const edit of edits) {
      if (edit.start < position)
        throw new Error('Group overlapping changes into one explained correction.');
      corrected += turn.text.slice(position, edit.start) + edit.replacement;
      position = edit.end;
    }
    corrected += turn.text.slice(position);
    if (corrected !== message.corrected)
      throw new Error('Every edit in the corrected message needs an explained quotation.');
  }
  return review;
}
// Merge overlapping exact quotations before rendering highlights; never inject HTML.
export function writingHighlights(text: string, feedback: WritingFeedback) {
  const ranges: { start: number; end: number }[] = [];
  for (const correction of feedback.corrections.filter((c) => c.kind === 'correction')) {
    let start = text.indexOf(correction.original);
    while (start !== -1) {
      ranges.push({ start, end: start + correction.original.length });
      start = text.indexOf(correction.original, start + correction.original.length);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const parts: { text: string; highlight: boolean }[] = [];
  let position = 0;
  for (const range of merged) {
    if (position < range.start)
      parts.push({ text: text.slice(position, range.start), highlight: false });
    parts.push({ text: text.slice(range.start, range.end), highlight: true });
    position = range.end;
  }
  if (position < text.length) parts.push({ text: text.slice(position), highlight: false });
  return parts;
}
