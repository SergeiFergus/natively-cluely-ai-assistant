/**
 * OPEN stand-in for the premium Natively-hosted search fallback.
 *
 * The upstream provider proxied web search through Natively's paid server. This
 * fork has no server access, so this provider is inert (returns no results) and
 * CompanyResearchEngine transparently falls back to LLM-only synthesis. Present
 * only so the require() in electron/ipcHandlers.ts resolves. No proprietary code.
 *
 * To get web-grounded dossiers, configure a Tavily API key — TavilySearchProvider
 * is preferred whenever a Tavily key is present.
 */

import type { SearchProvider, SearchResult } from './CompanyResearchEngine';

export class NativelySearchProvider implements SearchProvider {
    public quotaExhausted = false;

    constructor(_apiKey?: string, _trialToken?: string) { /* no hosted backend in this build */ }

    async search(_query: string): Promise<SearchResult[]> {
        return [];
    }
}
