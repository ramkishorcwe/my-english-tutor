import { GoogleGenAI } from '@google/genai';
import { generateWritingReview, WritingError } from '@/lib/writing-ai';
import type { Turn } from '@/lib/schema';
import { writingUser, writingJson, writingFailure, ownedWritingChat } from '@/lib/writing-server';
export const maxDuration = 120;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let release: (() => Promise<void>) | undefined;
  try {
    const { user, admin } = await writingUser(request, 'writing-chat-review', 6, 3600);
    const id = (await params).id;
    const chat = await ownedWritingChat(admin, user.id, id);
    if (chat.review) return writingJson(chat.review);
    if (chat.status !== 'ended')
      throw new WritingError('End the chat before reviewing your writing.', 409);
    if (!process.env.GEMINI_API_KEY) throw new WritingError('The AI tutor is not configured yet.');
    const claim = await admin.rpc('claim_writing_review', { p_user: user.id, p_chat: id });
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
    const review = await generateWritingReview(
      turns.data as Turn[],
      (p) => ai.models.generateContent(p),
      {
        get: async (key) => {
          const r = await admin
            .from('writing_review_batches')
            .select('data')
            .eq('chat_id', id)
            .eq('batch_key', key)
            .maybeSingle();
          if (r.error) throw new WritingError('Could not load review progress.');
          return r.data?.data;
        },
        set: async (key, data) => {
          const r = await admin
            .from('writing_review_batches')
            .upsert({ chat_id: id, batch_key: key, data });
          if (r.error) throw new WritingError('Could not save review progress. Please retry.');
        },
      },
    );
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
