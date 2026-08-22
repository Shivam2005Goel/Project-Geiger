import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-slate-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          That page does not exist. To look at a paper, search for it by DOI or title.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          Go to search
        </Link>
      </div>
    </main>
  );
}
