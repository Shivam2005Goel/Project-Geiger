import { NextResponse } from 'next/server';
import { getPaperGraph } from '@/lib/db/queries/paper';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ doi: string }> }
) {
  try {
    const p = await params;
    // Decode the DOI as it might be URL-encoded (e.g. 10.1038%2Fnature04533)
    const doi = decodeURIComponent(p.doi);

    const graph = await getPaperGraph(doi);

    if (!graph) {
      return NextResponse.json(
        { error: 'Paper not found in database' },
        { status: 404 }
      );
    }

    return NextResponse.json(graph);
  } catch (error) {
    console.error('Failed to fetch paper graph:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
