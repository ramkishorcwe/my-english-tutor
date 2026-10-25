import { WritingError } from '@/lib/writing-ai';
import { writingUser, writingJson, writingFailure, ownedWritingChat } from '@/lib/writing-server';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, admin } = await writingUser(request);
    const id = (await params).id;
    await ownedWritingChat(admin, user.id, id);
    const result = await admin.rpc('end_writing_chat', { p_user: user.id, p_chat: id });
    if (result.error) throw new WritingError(result.error.message, 409);
    return writingJson({ ok: true });
  } catch (error) {
    return writingFailure(error);
  }
}
