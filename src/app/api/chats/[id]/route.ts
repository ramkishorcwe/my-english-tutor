import { writingUser, writingJson, writingFailure, writingThread } from '@/lib/writing-server';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, admin } = await writingUser(request);
    return writingJson(await writingThread(admin, user.id, (await params).id));
  } catch (error) {
    return writingFailure(error);
  }
}
