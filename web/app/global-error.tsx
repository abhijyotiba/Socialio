'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
        <p className="text-red-500 text-sm">A critical error occurred.</p>
        <button
          onClick={reset}
          className="text-indigo-600 underline text-sm hover:text-indigo-800"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
