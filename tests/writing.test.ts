import { describe, it, expect, vi } from 'vitest';
import { defaultProfile, type Turn } from '../src/lib/schema';
import {
  generateWritingReply,
  generateWritingReview,
  generateWritingSummary,
} from '../src/lib/writing-ai';
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
      // Reproduce the real provider's rejection of the bounded nested batch schema.
      if (
        Array.isArray(input) &&
        input.length > 1 &&
        /"(?:minLength|maxLength|minItems|maxItems)":/.test(
          JSON.stringify(parameters.config.responseJsonSchema),
        )
      )
        throw Object.assign(new Error('Request contains an invalid argument.'), { status: 400 });
      if (!Array.isArray(input))
        return {
          text: JSON.stringify({
            summary:
              'You practised discussing visits to shops and describing what you did yesterday.',
          }),
        };
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
    const conversation: Turn[] = [
      ...turns,
      { id: crypto.randomUUID(), role: 'model', text: 'What did you buy?', sequence: 7 },
    ];
    const review = await generateWritingReview(
      conversation,
      generate,
      cache,
      'You are a shopkeeper.',
    );
    expect(review.summary).toContain('visits to shops');
    const summaryInput = generate.mock.calls
      .map(([p]) => JSON.parse(p.contents))
      .find((p) => !Array.isArray(p));
    expect(summaryInput.situation).toBe('You are a shopkeeper.');
    expect(summaryInput.conversation).toHaveLength(8);
    expect(summaryInput.conversation.at(-1).role).toBe('model');
    expect(review.messages).toHaveLength(7);
    expect(review.messages.flatMap((m) => m.corrections)).toHaveLength(14);
    expect(review.messages.map((m) => m.turnId)).toEqual(turns.map((t) => t.id));
    expect(generate).toHaveBeenCalledTimes(4);
    await generateWritingReview(conversation, generate, cache, 'You are a shopkeeper.');
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it('can add a missing summary to an older review without regenerating corrections', async () => {
    const saved = new Map<string, unknown>();
    const cache = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: unknown) => {
        saved.set(key, value);
      },
    };
    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify({ summary: 'You practised asking a shopkeeper for help.' }),
    });
    expect(await generateWritingSummary('Shopkeeper', turns, generate, cache)).toContain(
      'shopkeeper',
    );
    await generateWritingSummary('Shopkeeper', turns, generate, cache);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('still rejects oversized corrections locally when the provider format omits length bounds', async () => {
    const generate = vi.fn().mockImplementation(async (parameters) => {
      const input = JSON.parse(parameters.contents);
      return {
        text: JSON.stringify(
          Array.isArray(input)
            ? {
                messages: input.map((m: { id: string; text: string }) => ({
                  turnId: m.id,
                  corrected: 'x'.repeat(6001),
                  corrections: [
                    {
                      original: m.text,
                      corrected: 'x'.repeat(6001),
                      explanation: 'Oversized response',
                      kind: 'correction',
                    },
                  ],
                })),
              }
            : { summary: 'You practised describing yesterday’s shopping.' },
        ),
      };
    });
    await expect(
      generateWritingReview([turns[0]], generate, { get: async () => null, set: async () => {} }),
    ).rejects.toThrow('reviewed reliably');
    expect(generate.mock.calls.filter(([p]) => Array.isArray(JSON.parse(p.contents)))).toHaveLength(
      2,
    );
  });
  it('rejects malformed summaries and retains completed corrections for a retry', async () => {
    const saved = new Map<string, unknown>();
    const cache = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: unknown) => {
        saved.set(key, value);
      },
    };
    const generate = vi.fn().mockImplementation(async (p) => {
      const input = JSON.parse(p.contents);
      return {
        text: JSON.stringify(
          Array.isArray(input)
            ? {
                messages: input.map((m: { id: string; text: string }) => ({
                  turnId: m.id,
                  corrected: m.text,
                  corrections: [],
                })),
              }
            : { summary: '' },
        ),
      };
    });
    await expect(generateWritingReview([turns[0]], generate, cache)).rejects.toThrow('summary');
    expect(saved.has(turns[0].id)).toBe(true);
    expect(saved.has('conversation-summary:v1')).toBe(false);
  });
  it('recovers inconsistent batch feedback with server-grounded individual reviews and saves the result', async () => {
    const saved = new Map<string, unknown>();
    const cache = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: unknown) => {
        saved.set(key, value);
      },
    };
    const repeated = { ...turns[0], text: 'I go to shop. I go to shop.' };
    const valid = { ...turns[1], text: 'I enjoy reading.' };
    const generate = vi.fn().mockImplementation(async (parameters) => {
      const input = JSON.parse(parameters.contents);
      if (Array.isArray(input))
        return {
          text: JSON.stringify({
            messages: input.map((m: { id: string }) => ({
              turnId: m.id,
              corrected: 'I went to the shop.',
              corrections: [
                {
                  original: 'I go',
                  corrected: 'I went',
                  explanation: 'Past tense',
                  kind: 'correction',
                },
              ],
            })),
          }),
        };
      if (input.learnerMessage)
        return {
          text: JSON.stringify({
            corrected:
              input.learnerMessage === valid.text
                ? valid.text
                : 'I went to the shop. I went to the shop.',
            explanation:
              input.learnerMessage === valid.text
                ? ''
                : 'Use past tense and the article in both sentences.',
            kind: 'correction',
          }),
        };
      return {
        text: JSON.stringify({ summary: 'You practised talking about shopping and reading.' }),
      };
    });
    const result = await generateWritingReview([repeated, valid], generate, cache);
    expect(result.messages.map((m) => m.turnId)).toEqual([repeated.id, valid.id]);
    expect(result.messages[0].corrections[0].original).toBe(repeated.text);
    expect(result.messages[0].corrected).toBe('I went to the shop. I went to the shop.');
    expect(result.messages[1].corrections).toEqual([]);
    expect(() => validateWritingReview(result, [repeated, valid])).not.toThrow();
    const calls = generate.mock.calls.length;
    await generateWritingReview([repeated, valid], generate, cache);
    expect(generate).toHaveBeenCalledTimes(calls);
  });
  it('keeps completed individual feedback if another message fails and reuses it on retry', async () => {
    const saved = new Map<string, unknown>();
    const cache = {
      get: async (key: string) => saved.get(key),
      set: async (key: string, value: unknown) => {
        saved.set(key, value);
      },
    };
    let fail = true;
    const generate = vi.fn().mockImplementation(async (parameters) => {
      const input = JSON.parse(parameters.contents);
      if (Array.isArray(input)) return { text: JSON.stringify({ messages: [] }) };
      if (input.learnerMessage)
        return {
          text: JSON.stringify(
            input.learnerMessage === turns[1].text && fail
              ? { corrected: '', explanation: '', kind: 'correction' }
              : { corrected: input.learnerMessage, explanation: '', kind: 'optional' },
          ),
        };
      return { text: JSON.stringify({ summary: 'You practised describing shopping.' }) };
    });
    await expect(generateWritingReview(turns.slice(0, 2), generate, cache)).rejects.toThrow(
      'reviewed reliably',
    );
    expect(saved.has(`whole-message:v1:${turns[0].id}`)).toBe(true);
    fail = false;
    const result = await generateWritingReview(turns.slice(0, 2), generate, cache);
    expect(result.messages).toHaveLength(2);
    expect(
      generate.mock.calls.filter(([p]) => JSON.parse(p.contents).learnerMessage === turns[0].text),
    ).toHaveLength(1);
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
