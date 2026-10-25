import { z } from 'zod';
import { WritingError } from '@/lib/writing-ai';
import { writingUser, writingJson, writingFailure, writingBody } from '@/lib/writing-server';
export async function GET(request: Request) {
  try {
    const { user, admin } = await writingUser(request);
    const result = await admin
      .from('writing_chats')
      .select('id,topic,status,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (result.error)
      throw new WritingError('Your chats could not be loaded. Check the writing chat migration.');
    return writingJson({ chats: result.data });
  } catch (error) {
    return writingFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { user, admin } = await writingUser(request, 'writing-chat-start', 10, 86400);
    if (!process.env.GEMINI_API_KEY) throw new WritingError('The AI tutor is not configured yet.');
    const { topic } = z
      .object({ topic: z.string().trim().min(2).max(240).default('Surprise me') })
      .parse(await writingBody(request));
    const result = await admin
      .from('writing_chats')
      .insert({ user_id: user.id, topic })
      .select('id')
      .single();
    if (result.error)
      throw new WritingError('Could not start the chat. Check the writing chat migration.');
    return writingJson(result.data);
  } catch (error) {
    return writingFailure(error);
  }
}
