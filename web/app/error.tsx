'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <p className="text-red-500 text-sm">Something went wrong.</p>
      <button
        onClick={reset}
        className="text-indigo-600 underline text-sm hover:text-indigo-800"
      >
        Try again
      </button>
    </div>
  );
}
