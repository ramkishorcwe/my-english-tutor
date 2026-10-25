import { describe, it, expect, vi } from 'vitest';
import { defaultProfile, type Turn } from '../src/lib/schema';
import { generateWritingReply, generateWritingReview } from '../src/lib/writing-ai';
import { validateWritingReview, writingHighlights, writingMessageSchema } from '../src/lib/writing';
const turns: Turn[] = Array.from({ length: 7 }, (_, i) => ({
  id: crypto.randomUUID(),
  role: 'user',
  text: `Yesterday I go to shop ${i}.`,
  sequence: i,
}));
describe('written conversation', () => {
  it('starts an AI-led conversation without presenting it as learner writing', async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: 'I’m your AI tutor. What would your ideal weekend look like?' });
    await generateWritingReply('Surprise me', [], defaultProfile, generate);
    expect(generate.mock.calls[0][0].contents[0].parts[0].text).toContain(
      'Start our written English practice',
    );
    expect(generate.mock.calls[0][0].config.systemInstruction).toContain(
      'Save detailed language corrections',
    );
  });
  it('checks every learner message in batches, including more than three mistakes, and reuses saved progress', async () => {
    const saved = new Map<string, unknown>();
    const generate = vi.fn().mockImplementation(async (parameters) => {
      const input = JSON.parse(parameters.contents);
      return {
        text: JSON.stringify({
          messages: input.map((m: { id: string; text: string }) => ({
            turnId: m.id,
            corrected: m.text.replace('I go', 'I went').replace('to shop', 'to the shop'),
            corrections: [
              {
                original: 'I go',
                corrected: 'I went',
                explanation: 'Use past tense for yesterday.',
                kind: 'correction',
              },
              {
                original: 'to shop',
                corrected: 'to the shop',
                explanation: 'Use the article for a specific shop.',
                kind: 'correction',
              },
            ],
          })),
        }),
      };
    });
    const cache = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, data: unknown) => {
        saved.set(key, data);
      },
    };
    const review = await generateWritingReview(turns, generate, cache);
    expect(review.messages).toHaveLength(7);
    expect(review.messages.flatMap((m) => m.corrections)).toHaveLength(14);
    expect(review.messages.map((m) => m.turnId)).toEqual(turns.map((t) => t.id));
    expect(generate).toHaveBeenCalledTimes(3);
    await generateWritingReview(turns, generate, cache);
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it('rejects missing messages and made-up quotations instead of saving inaccurate feedback', () => {
    expect(() => validateWritingReview({ messages: [] }, turns)).toThrow('every learner');
    expect(() =>
      validateWritingReview(
        {
          messages: [
            {
              turnId: turns[0].id,
              corrected: 'I went.',
              corrections: [
                {
                  original: 'I am invented',
                  corrected: 'I went',
                  explanation: 'Not evidence',
                  kind: 'correction',
                },
              ],
            },
          ],
        },
        [turns[0]],
      ),
    ).toThrow('quotation');
  });
  it('rejects silent edits that were not highlighted or explained', () => {
    const turn = { ...turns[0], text: 'Yesterday I go to market.' };
    expect(() =>
      validateWritingReview(
        {
          messages: [
            {
              turnId: turn.id,
              corrected: 'Yesterday I went to the market.',
              corrections: [
                {
                  original: 'I go',
                  corrected: 'I went',
                  explanation: 'Past tense',
                  kind: 'correction',
                },
              ],
            },
          ],
        },
        [turn],
      ),
    ).toThrow('Every edit');
  });
  it('merges overlapping highlights and keeps optional improvements distinct', () => {
    const result = writingHighlights('I go to shop.', {
      turnId: 'a',
      corrected: 'I went to the shop.',
      corrections: [
        { original: 'I go', corrected: 'I went', explanation: 'Past tense', kind: 'correction' },
        {
          original: 'go to shop',
          corrected: 'went to the shop',
          explanation: 'Article',
          kind: 'correction',
        },
        { original: 'shop', corrected: 'store', explanation: 'Both are valid', kind: 'optional' },
      ],
    });
    expect(result).toEqual([
      { text: 'I go to shop', highlight: true },
      { text: '.', highlight: false },
    ]);
    expect(result.map((p) => p.text).join('')).toBe('I go to shop.');
  });
  it('rejects oversized learner messages and validates retry IDs', () => {
    expect(
      writingMessageSchema.safeParse({ requestId: crypto.randomUUID(), text: 'a'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      writingMessageSchema.safeParse({ requestId: 'not-a-request-id', text: 'Hello' }).success,
    ).toBe(false);
  });
});
