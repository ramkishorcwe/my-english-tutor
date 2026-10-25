import 'server-only';
import { z } from 'zod';
import { adminDb, serverDb } from './supabase/server';
import { WritingError } from './writing-ai';
export const writingJson = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export function writingFailure(error: unknown) {
  if (error instanceof WritingError) return writingJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return writingJson(
      {
        error: 'Please check your topic and message. Messages can contain up to 5,000 characters.',
      },
      400,
    );
  return writingJson(
    {
      error:
        'Written practice is temporarily unavailable. Your saved messages are safe; please retry.',
    },
    503,
  );
}
export async function writingUser(
  request: Request,
  action = 'writing-chat',
  limit = 30,
  seconds = 60,
) {
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
    throw new WritingError('Request origin is not allowed.', 403);
  const db = await serverDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new WritingError('Sign in to start a writing chat.', 401);
  const admin = adminDb();
  if (request.method !== 'GET') {
    const quota = await admin.rpc('consume_usage', {
      p_user: user.id,
      p_action: action,
      p_limit: limit,
      p_seconds: seconds,
    });
    if (quota.error) throw new WritingError('Chat settings are unavailable. Please retry.');
    if (!quota.data)
      throw new WritingError('Please wait before trying again. Your messages are saved.', 429);
  }
  return { user, admin, db };
}
export async function writingBody(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 65536)
    throw new WritingError('Request is too large.', 413);
  const raw = await request.text();
  if (raw.length > 65536) throw new WritingError('Request is too large.', 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new WritingError('Invalid request.', 400);
  }
}
export async function ownedWritingChat(
  admin: ReturnType<typeof adminDb>,
  userId: string,
  id: string,
) {
  z.uuid().parse(id);
  const result = await admin
    .from('writing_chats')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error)
    throw new WritingError('Written practice is unavailable. Check the database migration.');
  if (!result.data) throw new WritingError('Chat not found.', 404);
  return result.data;
}
export async function writingThread(admin: ReturnType<typeof adminDb>, userId: string, id: string) {
  const chat = await ownedWritingChat(admin, userId, id);
  const [turns, pending] = await Promise.all([
    admin
      .from('writing_chat_turns')
      .select('id,role,text,sequence')
      .eq('chat_id', id)
      .order('sequence'),
    admin
      .from('writing_chat_requests')
      .select('request_id,input_text')
      .eq('chat_id', id)
      .eq('complete', false)
      .limit(1)
      .maybeSingle(),
  ]);
  if (turns.error || pending.error) throw new WritingError('Could not load your saved messages.');
  return {
    chat: {
      id: chat.id,
      topic: chat.topic,
      status: chat.status,
      created_at: chat.created_at,
      review: chat.review,
    },
    turns: turns.data,
    pending:
      chat.status === 'active' && pending.data
        ? { requestId: pending.data.request_id, text: pending.data.input_text }
        : null,
  };
}
