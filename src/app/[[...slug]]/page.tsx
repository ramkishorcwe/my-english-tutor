import { SpeakBetter } from '@/components/speak-better';
import { Suspense } from 'react';
export default function Page() {
  return (
    <Suspense fallback={<div className="loading-state">Getting your space ready…</div>}>
      <SpeakBetter />
    </Suspense>
  );
}
