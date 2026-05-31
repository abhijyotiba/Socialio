'use client';

import { useEffect } from 'react';

// Next.js client error boundary. Fires whenever a React render or effect
// throws beneath the (app) segment. We report the error to /api/log-error
// so it lands in error_events alongside server-side failures.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message || 'Unknown render error',
        stack: error.stack,
        digest: error.digest,
        origin: 'app/error.tsx',
      }),
    }).catch(() => {
      // Reporting failure is non-fatal — the user already sees a fallback.
    });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <p className="text-destructive text-sm">Something went wrong.</p>
      <button
        onClick={reset}
        className="text-accent underline text-sm hover:brightness-110"
      >
        Try again
      </button>
    </div>
  );
}
