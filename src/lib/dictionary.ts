import { z } from 'zod';
export const TRANSLATION_LIMIT = 6000;
export const dictionaryLanguages = [
  'Hindi',
  'English',
  'Bengali',
  'Marathi',
  'Tamil',
  'Telugu',
  'Gujarati',
  'Kannada',
  'Malayalam',
  'Punjabi',
  'Urdu',
  'Spanish',
  'French',
  'German',
  'Arabic',
] as const;
export const dictionaryLookupSchema = z.object({
  text: z.string().trim().min(1).max(TRANSLATION_LIMIT),
  targetLanguage: z.enum(dictionaryLanguages),
});
export const dictionaryTranslationSchema = z.object({
  source_language: z.string().trim().min(1).max(60),
  translation: z.string().trim().min(1).max(24000),
  meaning: z.string().trim().min(1).max(1800),
  example: z.string().trim().min(1).max(1200),
});
export type DictionaryTranslation = z.infer<typeof dictionaryTranslationSchema>;
export type DictionaryEntry = DictionaryTranslation & {
  id: string;
  term: string;
  target_language: string;
  last_searched_at: string;
};
export function normalizedDictionaryTerm(text: string) {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
}
export function preferredDictionaryLanguage(language?: string) {
  return (
    dictionaryLanguages.find((l) => l.toLowerCase() === language?.trim().toLowerCase()) || 'Hindi'
  );
}
