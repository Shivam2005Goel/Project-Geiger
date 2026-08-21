'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GraphCanvas } from '@/components/graph-canvas';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function PaperViewPage() {
  const params = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // We need to unwrap params since in Next.js 15, `params` is a Promise, 
  // but `useParams` hook unwraps it for client components, returning a plain object.
  // Wait, Next.js 15 useParams returns a plain object now (or a promise depending on how it's used).
  // Next 15 `useParams` from `next/navigation` returns the parameters.
  
  const doi = Array.isArray(params?.doi) ? params.doi.join('/') : params?.doi;

  useEffect(() => {
    if (!doi) return;
    
    // In the hook, doi is already URL encoded if it came from the path, but let's be sure.
    // Actually, params.doi is decoded by Next.js router. So we need to encode it to pass to the API route correctly.
    const encodedDoi = encodeURIComponent(doi as string);

    async function fetchGraph() {
      try {
        const res = await fetch(`/api/paper/${encodedDoi}`);
        if (!res.ok) {
          throw new Error('Failed to fetch graph data');
        }
        const graph = await res.json();
        setData(graph);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchGraph();
  }, [doi]);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex h-16 items-center px-6 border-b bg-white shadow-sm shrink-0">
        <Link href="/" className="flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Link>
        <div className="ml-8 font-semibold text-slate-800">
          Paper Visualizer: {decodeURIComponent(doi as string || '')}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden p-6 gap-6">
        <div className="w-1/3 flex flex-col gap-6 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle>Graph Details</CardTitle>
              <CardDescription>Metrics and information about the current graph view.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[250px]" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              ) : error ? (
                <div className="text-red-500 text-sm">{error}</div>
              ) : data ? (
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nodes</span>
                    <span className="font-medium">{data.nodes?.length || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Edges</span>
                    <span className="font-medium">{data.edges?.length || 0}</span>
                  </div>
                  <div className="pt-4 border-t mt-4">
                    <h4 className="font-medium mb-2">Legend</h4>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-4 rounded-full bg-red-500"></div>
                      <span>Retracted</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                      <span>Active / Citing</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/50 backdrop-blur-sm rounded-xl">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
            </div>
          )}
          {data && <GraphCanvas data={data} />}
        </div>
      </main>
    </div>
  );
}
