import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { dictionaryLookupSchema, normalizedDictionaryTerm } from '@/lib/dictionary';
import { translateDictionaryText } from '@/lib/dictionary-ai';
import { WritingError } from '@/lib/writing-ai';
import { writingUser, writingJson, writingBody } from '@/lib/writing-server';
export const maxDuration = 120;
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return writingJson(
      {
        error: 'Enter a word, phrase, or message of up to 6,000 characters and choose a language.',
      },
      400,
    );
  if (error instanceof WritingError) return writingJson({ error: error.message }, error.status);
  return writingJson(
    { error: 'Your dictionary is temporarily unavailable. Please try again.' },
    503,
  );
}
export async function GET(request: Request) {
  try {
    const { db, user } = await writingUser(request);
    const url = new URL(request.url);
    const query = z
      .string()
      .max(120)
      .parse(url.searchParams.get('q') || '');
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(url.searchParams.get('page') || 0);
    let lookup = db
      .from('personal_dictionary')
      .select(
        'id,term,target_language,source_language,translation,meaning,example,last_searched_at',
      )
      .eq('user_id', user.id)
      .order('last_searched_at', { ascending: false })
      .order('id');
    if (query) lookup = lookup.ilike('term', `%${query.replace(/[\\%_]/g, '\\$&')}%`);
    const result = await lookup.range(page * 50, page * 50 + 50);
    if (result.error)
      throw new WritingError(
        'Your personal dictionary is not ready yet. Please check the database update.',
      );
    return writingJson({ entries: result.data.slice(0, 50), hasMore: result.data.length > 50 });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { admin, user } = await writingUser(request, 'dictionary-translate', 20, 60);
    const input = dictionaryLookupSchema.parse(await writingBody(request));
    const key = createHash('sha256').update(normalizedDictionaryTerm(input.text)).digest('hex');
    const existing = await admin
      .from('personal_dictionary')
      .select('*')
      .eq('user_id', user.id)
      .eq('term_key', key)
      .eq('target_language', input.targetLanguage)
      .maybeSingle();
    if (existing.error)
      throw new WritingError(
        'Your personal dictionary is not ready yet. Please check the database update.',
      );
    if (existing.data) {
      const updated = await admin
        .from('personal_dictionary')
        .update({ last_searched_at: new Date().toISOString() })
        .eq('id', existing.data.id)
        .eq('user_id', user.id)
        .select('*')
        .single();
      if (updated.error) throw new WritingError('Could not update your saved word. Please retry.');
      return writingJson({ entry: updated.data, saved: true, reused: true });
    }
    if (!process.env.GEMINI_API_KEY) throw new WritingError('Translation is not configured yet.');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const translated = await translateDictionaryText(input.text, input.targetLanguage, (p) =>
      ai.models.generateContent(p),
    );
    const saved = await admin
      .from('personal_dictionary')
      .upsert(
        {
          user_id: user.id,
          term: input.text,
          term_key: key,
          target_language: input.targetLanguage,
          ...translated,
          last_searched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,term_key,target_language' },
      )
      .select('*')
      .single();
    if (saved.error)
      throw new WritingError(
        'The translation could not be saved to your dictionary. Please retry.',
      );
    return writingJson({ entry: saved.data, saved: true, reused: false });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const { admin, user } = await writingUser(request, 'dictionary-remove', 30, 60);
    const id = z.uuid().parse(new URL(request.url).searchParams.get('id'));
    const result = await admin
      .from('personal_dictionary')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (result.error)
      throw new WritingError('Could not remove this dictionary entry. Please retry.');
    return writingJson({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
