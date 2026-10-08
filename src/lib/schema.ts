import { z } from 'zod';

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  native_language: z.string().trim().min(1).max(60),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  goal: z.enum(['Daily conversation', 'Work', 'Interviews', 'Travel', 'Presentations']),
  style: z.enum(['Gentle', 'Balanced', 'Intensive']),
  daily_target: z.number().int().min(5).max(60),
  voice: z.enum(['Kore', 'Puck', 'Aoede', 'Charon']).default('Kore'),
  memory_enabled: z.boolean().default(true),
  correction_mode: z.boolean().default(false),
});
export type Profile = z.infer<typeof profileSchema>;
export const defaultProfile: Profile = {
  name: 'Learner',
  native_language: 'Hindi',
  level: 'B1',
  goal: 'Daily conversation',
  style: 'Balanced',
  daily_target: 15,
  voice: 'Kore',
  memory_enabled: true,
  correction_mode: false,
};
export const sessionSchema = z.object({
  topic: z.string().trim().min(2).max(240),
  mode: z.string().max(60),
  difficulty: z.enum(['Comfortable', 'A little stretch', 'Challenge me']),
  duration: z.number().int().min(3).max(20),
  input_mode: z.enum(['hands-free', 'push-to-talk']),
});
export const turnSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'model']),
  text: z.string().min(1).max(12000),
  sequence: z.number().int().min(0).max(2000),
});
export type Turn = z.infer<typeof turnSchema>;
const evidence = { turnId: z.string(), original: z.string().min(1) };
export const reportSchema = z.object({
  summary: z.string(),
  successes: z.array(z.string()).max(5),
  strengths: z.array(z.string()).max(5),
  priorities: z.array(z.string()).max(3),
  grammar: z
    .array(
      z.object({
        ...evidence,
        corrected: z.string(),
        pattern: z
          .enum([
            'past-tense',
            'present-tense',
            'articles',
            'prepositions',
            'subject-verb-agreement',
            'word-order',
            'countability',
            'other',
          ])
          .default('other'),
        explanation: z.string(),
        example: z.string(),
      }),
    )
    .max(10),
  expressions: z
    .array(
      z.object({ ...evidence, alternative: z.string(), kind: z.enum(['correction', 'optional']) }),
    )
    .max(8),
  vocabulary: z
    .array(
      z.object({
        phrase: z.string(),
        meaning: z.string(),
        example: z.string(),
        prompt: z.string(),
        turnId: z.string(),
      }),
    )
    .max(8),
  exercises: z
    .array(
      z.object({
        type: z.enum(['say-again', 'fill-gap', 'rewrite', 'follow-up']),
        prompt: z.string(),
        answer: z.string(),
        turnId: z.string(),
      }),
    )
    .max(3),
  plan: z.string(),
  nextTopic: z.string(),
});
export type Report = z.infer<typeof reportSchema>;
export function validateEvidence(report: Report, turns: Turn[]) {
  for (const item of [...report.grammar, ...report.expressions]) {
    const turn = turns.find((t) => t.id === item.turnId && t.role === 'user');
    if (!turn || !turn.text.includes(item.original))
      throw new Error('Report contains an ungrounded quotation. Please retry.');
  }
  for (const item of [...report.exercises, ...report.vocabulary])
    if (!turns.some((t) => t.id === item.turnId && t.role === 'user'))
      throw new Error('Report contains an invalid transcript reference. Please retry.');
  return report;
}
