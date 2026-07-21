/**
 * OPEN web-grounding engine — "actualize any answer from the internet".
 *
 * Fetches fresh web context for a question and returns compact evidence the
 * live "What to answer" prompt can cite. Two backends:
 *   1. Tavily (when the user configured a Tavily API key) — clean, ranked,
 *      snippet-rich results. Free tier ~1000 searches/month.
 *   2. DuckDuckGo Lite (keyless fallback) — works out of the box, lower quality.
 *
 * No proprietary code, no Natively server. Bounded by a short timeout so a slow
 * or down search never stalls the live answer.
 */

export interface WebResult {
    title: string;
    url: string;
    snippet: string;
}

const DEFAULT_TIMEOUT_MS = 4500;
const MAX_RESULTS = 5;

function stripTags(s: string): string {
    return s
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export class WebGroundingEngine {
    private tavilyKey?: string;

    constructor(tavilyKey?: string) {
        this.tavilyKey = tavilyKey && tavilyKey.trim() ? tavilyKey.trim() : undefined;
    }

    /** True when the higher-quality Tavily backend is configured. */
    get usingTavily(): boolean {
        return Boolean(this.tavilyKey);
    }

    async search(query: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WebResult[]> {
        const q = (query || '').trim();
        if (!q) return [];
        if (this.tavilyKey) {
            const t = await this.searchTavily(q, timeoutMs).catch(() => [] as WebResult[]);
            if (t.length) return t;
        }
        return this.searchDuckDuckGo(q, timeoutMs).catch(() => [] as WebResult[]);
    }

    private async searchTavily(query: string, timeoutMs: number): Promise<WebResult[]> {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: this.tavilyKey,
                query,
                search_depth: 'basic',
                max_results: MAX_RESULTS,
                include_answer: true,
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return [];
        const data: any = await res.json();
        const out: WebResult[] = [];
        // Tavily's synthesized answer, when present, is the single best snippet.
        if (data?.answer && typeof data.answer === 'string') {
            out.push({ title: 'Summary', url: '', snippet: data.answer.slice(0, 600) });
        }
        for (const r of (data?.results || []).slice(0, MAX_RESULTS)) {
            out.push({
                title: stripTags(r.title || ''),
                url: r.url || '',
                snippet: stripTags(r.content || '').slice(0, 400),
            });
        }
        return out;
    }

    private async searchDuckDuckGo(query: string, timeoutMs: number): Promise<WebResult[]> {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return [];
        const htmlText = await res.text();
        // DDG Lite markup uses single-quoted class attributes:
        //   <a rel="nofollow" href="//duckduckgo.com/l/?uddg=<ENC>" class='result-link'>TITLE</a>
        //   <td class='result-snippet'>SNIPPET</td>
        const linkRe = /href="([^"]*uddg=[^"]*)"[^>]*class=['"]result-link['"][^>]*>(.*?)<\/a>/gis;
        const snipRe = /class=['"]result-snippet['"][^>]*>(.*?)<\/td>/gis;
        const titles: Array<{ title: string; url: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(htmlText)) && titles.length < MAX_RESULTS) {
            let href = m[1];
            const enc = href.match(/uddg=([^&]+)/);
            let real = '';
            if (enc) { try { real = decodeURIComponent(enc[1]); } catch { real = ''; } }
            titles.push({ title: stripTags(m[2]), url: real });
        }
        const snips: string[] = [];
        while ((m = snipRe.exec(htmlText)) && snips.length < MAX_RESULTS) {
            snips.push(stripTags(m[1]).slice(0, 400));
        }
        const out: WebResult[] = [];
        for (let i = 0; i < titles.length; i++) {
            if (!titles[i].title) continue;
            out.push({ title: titles[i].title, url: titles[i].url, snippet: snips[i] || '' });
        }
        return out;
    }

    /** Render results as a compact evidence block for the answer prompt. */
    static formatEvidence(results: WebResult[]): string {
        if (!results.length) return '';
        const lines = ['<web_evidence source="live_search" note="Fresh web results. Cite specifics; ignore anything irrelevant to the question.">'];
        for (const r of results) {
            const head = r.url ? `${r.title} (${r.url})` : r.title;
            lines.push(`- ${head}: ${r.snippet}`.trim());
        }
        lines.push('</web_evidence>');
        return lines.join('\n');
    }
}
