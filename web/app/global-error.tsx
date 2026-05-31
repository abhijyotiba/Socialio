'use client';

import { useEffect } from 'react';

// Top-level error boundary — fires when the root layout itself throws.
// Replaces the entire document, so it can't use any layout chrome. Reports
// to /api/log-error using the same path as app/error.tsx.
export default function GlobalError({
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
        message: error.message || 'Unknown root render error',
        stack: error.stack,
        digest: error.digest,
        origin: 'app/global-error.tsx',
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html>
      <body
        className="flex flex-col items-center justify-center min-h-screen gap-4 p-8"
        style={{ background: "#0A0A0B", color: "#F4F4F5" }}
      >
        <p className="text-sm" style={{ color: "#ef6b53" }}>A critical error occurred.</p>
        <button
          onClick={reset}
          className="underline text-sm"
          style={{ color: "#FF4D2E" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
