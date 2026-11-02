import { z } from 'zod';

export const pronunciationWords = [
  {
    id: 'comfortable',
    word: 'comfortable',
    meaning: 'Feeling relaxed and at ease.',
    group: 'Everyday tricky words',
  },
  {
    id: 'vegetable',
    word: 'vegetable',
    meaning: 'A plant or part of a plant used as food.',
    group: 'Everyday tricky words',
  },
  {
    id: 'wednesday',
    word: 'Wednesday',
    meaning: 'The day between Tuesday and Thursday.',
    group: 'Everyday tricky words',
  },
  {
    id: 'library',
    word: 'library',
    meaning: 'A place where you can borrow or read books.',
    group: 'Everyday tricky words',
  },
  {
    id: 'recipe',
    word: 'recipe',
    meaning: 'Instructions for preparing a dish.',
    group: 'Everyday tricky words',
  },
  {
    id: 'queue',
    word: 'queue',
    meaning: 'A line of people waiting their turn.',
    group: 'Everyday tricky words',
  },
  {
    id: 'clothes',
    word: 'clothes',
    meaning: 'The things you wear.',
    group: 'Everyday tricky words',
  },
  {
    id: 'world',
    word: 'world',
    meaning: 'The earth and the people and places on it.',
    group: 'Everyday tricky words',
  },
  {
    id: 'pronunciation',
    word: 'pronunciation',
    meaning: 'The way a word is spoken.',
    group: 'Words for work',
  },
  {
    id: 'colleague',
    word: 'colleague',
    meaning: 'Someone you work with.',
    group: 'Words for work',
  },
  {
    id: 'development',
    word: 'development',
    meaning: 'The process of growing or improving.',
    group: 'Words for work',
  },
  {
    id: 'architecture',
    word: 'architecture',
    meaning: 'The design or structure of a building or system.',
    group: 'Words for work',
  },
  {
    id: 'particularly',
    word: 'particularly',
    meaning: 'Especially, or more than usual.',
    group: 'Words for work',
  },
  {
    id: 'hierarchy',
    word: 'hierarchy',
    meaning: 'A system arranged in levels of authority or importance.',
    group: 'Words for work',
  },
  {
    id: 'entrepreneur',
    word: 'entrepreneur',
    meaning: 'Someone who starts and runs a business.',
    group: 'Words for work',
  },
  {
    id: 'negotiation',
    word: 'negotiation',
    meaning: 'A discussion intended to reach an agreement.',
    group: 'Words for work',
  },
  {
    id: 'rural',
    word: 'rural',
    meaning: 'Related to the countryside.',
    group: 'A little more challenge',
  },
  {
    id: 'squirrel',
    word: 'squirrel',
    meaning: 'A small animal with a long, bushy tail.',
    group: 'A little more challenge',
  },
  {
    id: 'thorough',
    word: 'thorough',
    meaning: 'Careful and complete.',
    group: 'A little more challenge',
  },
  {
    id: 'choir',
    word: 'choir',
    meaning: 'A group of people who sing together.',
    group: 'A little more challenge',
  },
  {
    id: 'mischievous',
    word: 'mischievous',
    meaning: 'Enjoying playful trouble or harmless tricks.',
    group: 'A little more challenge',
  },
  {
    id: 'anemone',
    word: 'anemone',
    meaning: 'A type of flower; also the name of a sea animal.',
    group: 'A little more challenge',
  },
  {
    id: 'phenomenon',
    word: 'phenomenon',
    meaning: 'An event or fact that can be observed.',
    group: 'A little more challenge',
  },
  {
    id: 'conscientious',
    word: 'conscientious',
    meaning: 'Taking care to do your work properly.',
    group: 'A little more challenge',
  },
] as const;

export const pronunciationAssessmentSchema = z.object({
  verdict: z.enum(['clear', 'try_again', 'no_speech', 'uncertain']),
  confidence: z.enum(['high', 'medium', 'low']),
  heard: z.string().trim().max(120),
  feedback: z.string().trim().min(1).max(900),
  tip: z.string().trim().max(500),
});
export type PronunciationAssessment = z.infer<typeof pronunciationAssessmentSchema>;
export const pronunciationWordIdSchema = z.enum(pronunciationWords.map((w) => w.id));
export function verifiedPronunciationResult(
  word: string,
  result: PronunciationAssessment,
): PronunciationAssessment {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
  // Identical sounds can be transcribed with another spelling; this is pronunciation,
  // not a spelling quiz. Never use fuzzy word matching for genuinely different sounds.
  const equivalentSpellings: Record<string, string[]> = {
    queue: ['queue', 'cue', 'q'],
    world: ['world', 'whirled'],
  };
  const heard = normalized(result.heard),
    target = normalized(word);
  if (
    result.verdict === 'clear' &&
    (result.confidence !== 'high' || !(equivalentSpellings[target] || [target]).includes(heard))
  )
    return {
      ...result,
      verdict: 'uncertain',
      feedback: 'I could not confidently verify that word. Listen to the example and try again.',
      tip: result.tip || 'Say just the displayed word in a quiet place.',
    };
  return result;
}

export function speechChunks(text: string, limit = 180) {
  const words = text.trim().split(/\s+/u);
  const chunks: string[] = [];
  for (const word of words) {
    if (!word) continue;
    const previous = chunks.at(-1);
    if (previous && previous.length + word.length + 1 <= limit)
      chunks[chunks.length - 1] += ` ${word}`;
    else if (word.length <= limit) chunks.push(word);
    else
      for (let start = 0; start < word.length; start += limit)
        chunks.push(word.slice(start, start + limit));
  }
  return chunks;
}
