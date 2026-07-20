/**
 * OPEN company-research engine.
 *
 * Produces an interviewer-ready company dossier tailored to the active JD.
 * When a search provider is wired (Tavily user key or Natively fallback) it
 * grounds the dossier in fresh web results; otherwise it falls back to the
 * LLM's own knowledge with an explicit freshness caveat. No proprietary code.
 */

type GenFn = (contents: any[]) => Promise<string>;

export interface SearchResult { title?: string; url?: string; content?: string; }
export interface SearchProvider {
    search(query: string): Promise<SearchResult[]>;
    quotaExhausted?: boolean;
}

export class CompanyResearchEngine {
    private generateContentFn: GenFn;
    public searchProvider: SearchProvider | null = null;

    constructor(generateContentFn: GenFn) {
        this.generateContentFn = generateContentFn;
    }

    setSearchProvider(provider: SearchProvider): void {
        this.searchProvider = provider;
    }

    async researchCompany(companyName: string, jdCtx: any = {}, _tailored = true): Promise<any> {
        const name = (companyName || '').trim();
        if (!name) return { company: '', summary: '', grounded: false };

        // 1. Gather web context if a provider is available.
        let webContext = '';
        let grounded = false;
        if (this.searchProvider) {
            try {
                const queries = [
                    `${name} company overview products`,
                    `${name} recent news 2026`,
                    `${name} engineering culture interview`,
                ];
                const seen = new Set<string>();
                const blocks: string[] = [];
                for (const q of queries) {
                    const results = await this.searchProvider.search(q);
                    for (const r of (results || []).slice(0, 4)) {
                        const key = r.url || r.title || r.content?.slice(0, 40) || '';
                        if (!key || seen.has(key)) continue;
                        seen.add(key);
                        blocks.push(`[${r.title || 'source'}] ${(r.content || '').slice(0, 600)}`);
                    }
                }
                if (blocks.length) { webContext = blocks.join('\n\n'); grounded = true; }
            } catch (e: any) {
                console.warn('[OSS-CompanyResearch] search failed, using LLM-only:', e?.message);
            }
        }

        // 2. Synthesize the dossier.
        const jdLine = jdCtx && (jdCtx.title || jdCtx.technologies)
            ? `\nThe candidate is interviewing for: ${[jdCtx.title, jdCtx.level].filter(Boolean).join(' ')}${
                  Array.isArray(jdCtx.technologies) && jdCtx.technologies.length ? ` (stack: ${jdCtx.technologies.join(', ')})` : ''
              }.`
            : '';
        const groundingNote = grounded
            ? `Use the WEB CONTEXT below as the primary source; cite concrete facts from it.`
            : `No live web search was available. Use your own knowledge and clearly mark anything you are unsure about as "verify".`;

        const prompt = `You are prepping a candidate for an interview with "${name}".${jdLine}
${groundingNote}

Produce a concise, practical dossier in Markdown with these sections:
## What they do
## Products / business model
## Recent developments
## Likely interview focus (tailored to the role)
## Smart questions to ask them
## Talking points to connect the candidate's background

Keep it tight and specific. Do not invent funding numbers, headcounts, or dates — if unknown, say "verify".
${webContext ? `\n\nWEB CONTEXT:\n${webContext}` : ''}`;

        let summary = '';
        try {
            summary = await this.generateContentFn([{ text: prompt }]);
        } catch (e: any) {
            return { company: name, summary: '', grounded, error: e?.message };
        }
        return { company: name, summary: (summary || '').trim(), grounded };
    }
}
