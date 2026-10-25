import { GoogleGenAI } from '@google/genai';
import { generateWritingReview, generateWritingSummary, WritingError } from '@/lib/writing-ai';
import type { Turn } from '@/lib/schema';
import { writingUser, writingJson, writingFailure, ownedWritingChat } from '@/lib/writing-server';
export const maxDuration = 120;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let release: (() => Promise<void>) | undefined;
  try {
    const { user, admin } = await writingUser(request, 'writing-chat-review', 6, 3600);
    const id = (await params).id;
    const chat = await ownedWritingChat(admin, user.id, id);
    if (chat.review?.summary) return writingJson(chat.review);
    if (chat.status !== 'ended')
      throw new WritingError('End the chat before reviewing your writing.', 409);
    if (!process.env.GEMINI_API_KEY) throw new WritingError('The AI tutor is not configured yet.');
    const claim = chat.review
      ? await admin
          .from('writing_chats')
          .update({
            review_until: new Date(Date.now() + 180000).toISOString(),
            review_lease: crypto.randomUUID(),
          })
          .eq('id', id)
          .eq('user_id', user.id)
          .eq('status', 'ended')
          .is('review->>summary', null)
          .or(`review_until.is.null,review_until.lt.${new Date().toISOString()}`)
          .select('review_lease')
          .maybeSingle()
          .then(({ data, error }) => ({ data: data?.review_lease, error }))
      : await admin.rpc('claim_writing_review', { p_user: user.id, p_chat: id });
    if (claim.error) throw new WritingError('Could not start your writing review.');
    if (!claim.data)
      throw new WritingError(
        'Your review is already being prepared. Try again in a few minutes.',
        409,
      );
    const lease = claim.data;
    release = async () => {
      await admin
        .from('writing_chats')
        .update({ review_lease: null, review_until: null })
        .eq('id', id)
        .eq('user_id', user.id)
        .eq('review_lease', lease);
    };
    const turns = await admin
      .from('writing_chat_turns')
      .select('id,role,text,sequence')
      .eq('chat_id', id)
      .order('sequence');
    if (turns.error) throw new WritingError('Could not read your saved writing.');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const cache = {
      get: async (key: string) => {
        const r = await admin
          .from('writing_review_batches')
          .select('data')
          .eq('chat_id', id)
          .eq('batch_key', key)
          .maybeSingle();
        if (r.error) throw new WritingError('Could not load review progress.');
        return r.data?.data;
      },
      set: async (key: string, data: unknown) => {
        const r = await admin
          .from('writing_review_batches')
          .upsert({ chat_id: id, batch_key: key, data });
        if (r.error) throw new WritingError('Could not save review progress. Please retry.');
      },
    };
    const generate = (p: Parameters<typeof ai.models.generateContent>[0]) =>
      ai.models.generateContent(p);
    const review = chat.review
      ? {
          ...chat.review,
          summary: await generateWritingSummary(chat.topic, turns.data as Turn[], generate, cache),
        }
      : await generateWritingReview(turns.data as Turn[], generate, cache, chat.topic);
    const saved = await admin
      .from('writing_chats')
      .update({ review })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('review_lease', lease)
      .select('id')
      .maybeSingle();
    if (saved.error || !saved.data)
      throw new WritingError('The review changed while saving. Please reload.', 409);
    return writingJson(review);
  } catch (error) {
    return writingFailure(error);
  } finally {
    await release?.().catch(() => {});
  }
}
