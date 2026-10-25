import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SpeakBetter',
    short_name: 'SpeakBetter',
    description: 'Build confidence with English speaking and writing practice.',
    start_url: '/practice',
    scope: '/',
    display: 'standalone',
    background_color: '#f8faf9',
    theme_color: '#237463',
    icons: [
      { src: '/icons/speakbetter-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/speakbetter-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/speakbetter-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
