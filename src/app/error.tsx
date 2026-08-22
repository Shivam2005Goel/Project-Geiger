'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Root error boundary.
 *
 * Shows the digest rather than the raw message: Next.js redacts server errors in
 * production, and the digest is what makes a user report traceable to a log line.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[geiger] unhandled error', error);
  }, [error]);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-slate-100">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-400">
          This is a bug on our side, not a problem with the paper you looked up.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-600">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
