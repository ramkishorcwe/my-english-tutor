import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SpeakBetter',
    short_name: 'SpeakBetter',
    description: 'Daily English speaking practice',
    start_url: '/practice',
    display: 'standalone',
    background_color: '#f8faf9',
    theme_color: '#237463',
    icons: [{ src: '/icons/reminder.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
