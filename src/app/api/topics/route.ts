import { loadNewsTopics } from '@/lib/topics';

export async function GET() {
  const result = await loadNewsTopics();
  return Response.json(result, {
    headers: {
      'Cache-Control': result.unavailable ? 'no-store' : 'public, max-age=300, s-maxage=900',
    },
  });
}
