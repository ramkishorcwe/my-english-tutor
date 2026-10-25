import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  applicationName: 'SpeakBetter',
  appleWebApp: { capable: true, title: 'SpeakBetter', statusBarStyle: 'default' },
  title: 'SpeakBetter — Find your voice',
  description:
    'A little practice. A more confident you. Natural English conversations with your AI coach.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
