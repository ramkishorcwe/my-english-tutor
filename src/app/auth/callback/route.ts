import { NextRequest, NextResponse } from 'next/server';
import { serverDb } from '@/lib/supabase/server';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  try {
    if (code) {
      const db = await serverDb();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) {
        const {
          data: { user },
        } = await db.auth.getUser();
        const { data: profile } = await db
          .from('profiles')
          .select('id')
          .eq('id', user?.id ?? '')
          .maybeSingle();
        return NextResponse.redirect(new URL(profile ? '/' : '/onboarding', request.url));
      }
    }
  } catch {
    /* Return to the recovery flow without logging auth codes or tokens. */
  }
  return NextResponse.redirect(new URL('/signin?error=link', request.url));
}
