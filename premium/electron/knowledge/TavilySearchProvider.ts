/**
 * OPEN Tavily search provider for company research.
 * Uses the user's own Tavily API key (Settings → configured separately).
 * No proprietary code — thin wrapper over the public Tavily REST API.
 */

import type { SearchProvider, SearchResult } from './CompanyResearchEngine';

export class TavilySearchProvider implements SearchProvider {
    private apiKey: string;
    public quotaExhausted = false;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async search(query: string): Promise<SearchResult[]> {
        try {
            const res = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    query,
                    search_depth: 'basic',
                    max_results: 5,
                    include_answer: false,
                }),
                signal: AbortSignal.timeout(12_000),
            });
            if (res.status === 429 || res.status === 402) { this.quotaExhausted = true; return []; }
            if (!res.ok) return [];
            const data: any = await res.json();
            return (data?.results || []).map((r: any) => ({
                title: r.title,
                url: r.url,
                content: r.content,
            }));
        } catch {
            return [];
        }
    }
}
