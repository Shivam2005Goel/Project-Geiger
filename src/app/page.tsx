import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function Home() {
  const exampleDoi = '10.1038/nature04533';
  // Note: App Router uses Next.js Link component which automatically handles url encoding appropriately, 
  // but it's safer to encode it explicitly if we use it directly in href string.
  const encodedDoi = encodeURIComponent(exampleDoi);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-100">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-3xl font-bold tracking-tight">Citation Contamination Visualizer</CardTitle>
          <CardDescription>
            Explore the blast radius of retracted scientific papers through interactive citation graphs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-600">
            When a foundational paper is retracted, the research that built upon it doesn't disappear. 
            This tool visualizes the "generations" of citations, highlighting the downstream impact of retracted science.
          </p>
          
          <div className="pt-6">
            <Link 
              href={`/paper/${encodedDoi}`}
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-8 text-sm font-medium text-slate-50 shadow transition-colors hover:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50"
            >
              View Example: Lesné (2006) Alzheimer's Paper
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
