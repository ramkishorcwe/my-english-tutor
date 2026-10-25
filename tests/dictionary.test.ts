import { describe, it, expect, vi } from 'vitest';
import {
  dictionaryLookupSchema,
  normalizedDictionaryTerm,
  preferredDictionaryLanguage,
} from '../src/lib/dictionary';
import { translateDictionaryText } from '../src/lib/dictionary-ai';
describe('personal dictionary translation', () => {
  it('normalizes repeated searches without changing the saved display text', () => {
    expect(normalizedDictionaryTerm('  TAKE\n the  initiative ')).toBe(
      normalizedDictionaryTerm('take the initiative'),
    );
    expect(preferredDictionaryLanguage('hindi')).toBe('Hindi');
    expect(
      dictionaryLookupSchema.safeParse({ text: 'hello', targetLanguage: 'Invalid' }).success,
    ).toBe(false);
    expect(
      dictionaryLookupSchema.safeParse({ text: 'x'.repeat(6001), targetLanguage: 'Hindi' }).success,
    ).toBe(false);
  });
  it('translates a word with an English meaning and usage example', async () => {
    const answer = {
      source_language: 'English',
      translation: 'पहल करना',
      meaning: 'To take the first step without being asked.',
      example: 'She took the initiative to organise the meeting.',
    };
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(answer) });
    expect(await translateDictionaryText('take the initiative', 'Hindi', generate)).toEqual(answer);
    expect(JSON.parse(generate.mock.calls[0][0].contents)).toEqual({
      text: 'take the initiative',
      targetLanguage: 'Hindi',
    });
  });
  it('rejects malformed translation results rather than saving incomplete entries', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '{"translation":"hello"}' });
    await expect(translateDictionaryText('नमस्ते', 'English', generate)).rejects.toThrow(
      'could not be prepared',
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
