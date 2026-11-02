import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // Keep the SDK's native Node WebSocket transport intact in route handlers.
  serverExternalPackages: ['@google/genai'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' },
        ],
      },
    ];
  },
};
export default config;
