import { NextResponse } from 'next/server';

const MOCK_SNIPPETS = [
  "Our results are consistent with the findings reported by {target}, suggesting a robust phenomenon.",
  "In contrast to {target}, we did not observe significant differences in the control group.",
  "We utilized the methodology described in {target} for our primary analysis.",
  "Previous work by {target} has established the theoretical foundation for this approach.",
  "However, recent meta-analyses have called the conclusions of {target} into question.",
];

export async function POST(request: Request) {
  try {
    const { sourceId, targetId, title } = await request.json();

    if (!sourceId || !targetId) {
      return NextResponse.json({ error: 'Missing sourceId or targetId' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
      // Real LLM Integration goes here
      // For now, even if key exists, we fall back to mock unless we install openai sdk
    }

    // Mock response
    const snippet = MOCK_SNIPPETS[Math.floor(Math.random() * MOCK_SNIPPETS.length)]
      .replace('{target}', title ? `"${title}"` : 'the referenced work');
      
    let sentiment: 'supporting' | 'contrasting' | 'mentioning' = 'mentioning';
    if (snippet.includes('consistent') || snippet.includes('established') || snippet.includes('methodology')) {
      sentiment = 'supporting';
    } else if (snippet.includes('contrast') || snippet.includes('question')) {
      sentiment = 'contrasting';
    }

    // Simulate network delay for AI processing
    await new Promise(resolve => setTimeout(resolve, 800));

    return NextResponse.json({
      sentiment,
      snippet,
      confidence: (Math.random() * 0.4 + 0.6).toFixed(2), // 0.60 - 0.99
      isMock: !apiKey
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to analyze citation context' }, { status: 500 });
  }
}
