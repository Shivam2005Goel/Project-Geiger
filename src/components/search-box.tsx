'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2, Search } from 'lucide-react';

import { STATUS } from '@/lib/ui/presentation';
import type { SearchResult } from '@/lib/types';

/**
 * The way into the tool.
 *
 * Accepts a DOI, an OpenAlex ID, a PMID, an arXiv ID, a title or an author
 * name, and searches the local corpus before falling back to OpenAlex. Results
 * are explicit about which of the two they came from: a paper we hold has a
 * contamination score behind it, and one we merely found upstream does not
 * yet.
 */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setResults(null);
      setOpen(false);
      return;
    }

    // Cancel the previous request so out-of-order responses cannot overwrite
    // newer results with older ones.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=8`,
        { signal: controller.signal },
      );
      if (!response.ok) return;
      const body = await response.json();
      setResults(body.results as SearchResult[]);
      setOpen(true);
      setHighlighted(-1);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setResults([]);
        setOpen(true);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const go = (result: SearchResult) => {
    if (result.doi) {
      router.push(`/paper/${encodeURIComponent(result.doi)}`);
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (highlighted >= 0 && results?.[highlighted]) {
      go(results[highlighted]);
      return;
    }
    // A pasted DOI should work without waiting for the dropdown.
    const direct = query.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    if (/^10\.\d{4,9}\/\S+$/.test(direct)) {
      router.push(`/paper/${encodeURIComponent(direct)}`);
    } else if (results?.[0]) {
      go(results[0]);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || !results?.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={onSubmit}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => results && setOpen(true)}
            placeholder="DOI, title, author, PMID or arXiv ID"
            aria-label="Search for a paper"
            className="h-12 w-full rounded-lg border border-white/15 bg-black/50 pl-10 pr-10 text-base text-slate-100 outline-none backdrop-blur transition-colors placeholder:text-slate-600 focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20"
          />
          {loading && (
            <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500" />
          )}
        </div>
      </form>

      {open && results && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/95 py-1 shadow-2xl backdrop-blur-xl">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500">
              Nothing found. Try a DOI, or check the spelling of the title.
            </li>
          ) : (
            results.map((result, index) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => go(result)}
                  onMouseEnter={() => setHighlighted(index)}
                  disabled={!result.doi}
                  className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors disabled:opacity-40 ${
                    index === highlighted ? 'bg-white/8' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="line-clamp-2 text-sm text-slate-200">
                    {result.title ?? result.doi ?? result.id}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {result.authors[0] && <span>{result.authors[0]}</span>}
                    {result.publicationYear && <span>{result.publicationYear}</span>}
                    {result.venue && <span className="italic">{result.venue}</span>}
                    <span>{result.citedByCount.toLocaleString()} citations</span>

                    {result.status !== 'clean' && (
                      <span className={`rounded border px-1 ${STATUS[result.status].badge}`}>
                        {STATUS[result.status].label}
                      </span>
                    )}

                    {result.inDatabase ? (
                      <span className="flex items-center gap-0.5 text-emerald-500/80">
                        <Database className="h-2.5 w-2.5" />
                        analysed
                        {result.contaminationScore !== null && result.contaminationScore > 0 &&
                          ` · score ${result.contaminationScore}`}
                      </span>
                    ) : (
                      <span className="text-slate-600">will be fetched</span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
