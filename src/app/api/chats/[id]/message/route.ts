import { GoogleGenAI } from '@google/genai';
import { writingMessageSchema } from '@/lib/writing';
import { defaultProfile, profileSchema, type Turn } from '@/lib/schema';
import { generateWritingReply, WritingError } from '@/lib/writing-ai';
import {
  writingUser,
  writingJson,
  writingFailure,
  writingThread,
  writingBody,
  ownedWritingChat,
} from '@/lib/writing-server';
export const maxDuration = 90;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let release: (() => Promise<void>) | undefined;
  try {
    const { user, admin, db } = await writingUser(request, 'writing-chat-message', 12, 60);
    const id = (await params).id;
    const chat = await ownedWritingChat(admin, user.id, id);
    const body = writingMessageSchema.parse(await writingBody(request));
    if (!process.env.GEMINI_API_KEY) throw new WritingError('The AI tutor is not configured yet.');
    const claim = await admin.rpc('claim_writing_reply', {
      p_user: user.id,
      p_chat: id,
      p_request: body.requestId,
      p_text: body.text,
    });
    if (claim.error) throw new WritingError(claim.error.message, 409);
    if (claim.data.state === 'busy')
      throw new WritingError(
        'Your tutor is still preparing a reply. Wait a moment, then retry.',
        409,
      );
    if (claim.data.state === 'complete')
      return writingJson(await writingThread(admin, user.id, id));
    const lease = claim.data.lease;
    release = async () => {
      await admin
        .from('writing_chat_requests')
        .update({ lease_until: null, lease: null })
        .eq('chat_id', id)
        .eq('request_id', body.requestId)
        .eq('lease', lease);
    };
    const [turns, profile] = await Promise.all([
      admin
        .from('writing_chat_turns')
        .select('id,role,text,sequence')
        .eq('chat_id', id)
        .order('sequence'),
      db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    ]);
    if (turns.error || profile.error)
      throw new WritingError('Could not load your chat context. Please retry.');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const reply = await generateWritingReply(
      chat.topic,
      turns.data as Turn[],
      profileSchema.parse(profile.data ?? defaultProfile),
      (p) => ai.models.generateContent(p),
    );
    if (reply.length > 6000) throw new WritingError('The tutor reply was too long. Please retry.');
    const commit = await admin.rpc('complete_writing_reply', {
      p_user: user.id,
      p_chat: id,
      p_request: body.requestId,
      p_lease: lease,
      p_reply: reply,
    });
    if (commit.error || !commit.data)
      throw new WritingError(
        'The chat changed while the tutor was replying. Reload your saved messages.',
        409,
      );
    return writingJson(await writingThread(admin, user.id, id));
  } catch (error) {
    return writingFailure(error);
  } finally {
    await release?.().catch(() => {});
  }
}
