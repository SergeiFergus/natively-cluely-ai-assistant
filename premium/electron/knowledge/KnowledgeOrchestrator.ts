/**
 * OPEN re-implementation of the premium KnowledgeOrchestrator.
 *
 * Restores Profile Intelligence (résumé/JD grounding + company research) using
 * the owner's own LLM + embedding keys, with zero dependency on the closed
 * premium bundle or any Natively server. Built to satisfy exactly the public
 * interface the app calls (see electron/ipcHandlers.ts + electron/main.ts):
 *
 *   Wiring setters (main.ts): setGenerateContentFn, setLiveCoachingContentFn,
 *     setEmbedFn, setEmbedQueryFn, setFastQueryEmbedFn, setActiveSpaceFn,
 *     setConversationContextProvider, ensureEmbeddingSpace, setCustomNotes.
 *   Feature methods (ipcHandlers): ingestDocument, processQuestion, getStatus,
 *     getProfileData, deleteDocumentsByType, setKnowledgeMode, isKnowledgeMode,
 *     getCompanyResearchEngine, negotiation stubs.
 *   Properties read by the engine: activeResume.structured_data,
 *     activeJD.structured_data.
 *
 * The grounding contract for processQuestion() is reverse-engineered from
 * electron/IntelligenceEngine.ts (~line 1167): return
 *   { factualRecall: true, contextBlock, isIntroQuestion, introResponse }
 * and the existing (open) answer path injects it into the live prompt.
 *
 * Contains no proprietary code.
 */

import { DocType, StructuredProfileFacts, StructuredJobFacts } from './types';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { CompanyResearchEngine } from './CompanyResearchEngine';

type GenFn = (contents: any[]) => Promise<string>;
type EmbedFn = (text: string) => Promise<number[]>;

const CHUNK_CHARS = 700;
const CHUNK_OVERLAP = 120;
const RETRIEVE_TOP_K = 5;

function cosine(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Extract the first balanced JSON object/array from an LLM response that may
 *  be fenced or prose-wrapped. Returns null if nothing parses. */
function parseJsonLoose(text: string): any {
    if (!text) return null;
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // Try direct parse first.
    try { return JSON.parse(s); } catch { /* fall through */ }
    // Find the first {...} or [...] balanced span.
    const start = s.search(/[{[]/);
    if (start < 0) return null;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === close) {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

function chunkText(text: string): string[] {
    const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];
    const out: string[] = [];
    let i = 0;
    while (i < clean.length) {
        out.push(clean.slice(i, i + CHUNK_CHARS));
        i += CHUNK_CHARS - CHUNK_OVERLAP;
    }
    return out;
}

async function extractDocumentText(filePath: string): Promise<string> {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.pdf')) {
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: require('fs').readFileSync(filePath) });
        const res = await parser.getText();
        return (res?.text || '').trim();
    }
    if (lower.endsWith('.docx')) {
        const mammoth = require('mammoth');
        const res = await mammoth.extractRawText({ path: filePath });
        return (res?.value || '').trim();
    }
    // txt / md / any plain text
    return require('fs').readFileSync(filePath, 'utf-8').trim();
}

const RESUME_EXTRACTION_PROMPT = `You are a precise résumé parser. Extract the candidate's factual profile from the résumé text below into STRICT JSON. Output ONLY the JSON object, no prose, no markdown fences.

Schema:
{
  "identity": { "name": string, "role": string, "location": string, "summary": string, "links": string[] },
  "skills": string[],
  "experience": [ { "role": string, "company": string, "dates": string, "location": string, "highlights": string[] } ],
  "projects": [ { "name": string, "description": string, "technologies": string[] } ],
  "education": [ { "degree": string, "institution": string, "year": string } ]
}

Rules:
- Use ONLY facts present in the text. Never invent names, companies, dates, or metrics.
- Omit any field that is not stated (do not emit empty strings for unknowns).
- "role" in identity = the candidate's current/target title.
- Keep highlights concise (max ~6 per role), preserving concrete numbers.

RÉSUMÉ TEXT:
`;

const JD_EXTRACTION_PROMPT = `You are a precise job-description parser. Extract the role's facts from the text below into STRICT JSON. Output ONLY the JSON object, no prose, no markdown fences.

Schema:
{
  "title": string, "company": string, "location": string, "level": string,
  "employment_type": string, "min_years_experience": number,
  "requirements": string[], "nice_to_haves": string[], "responsibilities": string[],
  "technologies": string[], "keywords": string[],
  "description_summary": string, "compensation_hint": string
}

Rules:
- Use ONLY facts present in the text. Never invent requirements or compensation.
- Omit any field that is not stated.

JOB DESCRIPTION TEXT:
`;

/** Regex fallback when no LLM is reachable — captures at least a name/role so
 *  identity questions still ground. */
function heuristicResume(text: string): StructuredProfileFacts {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const name = lines[0] && lines[0].length < 60 && /^[A-Za-zА-Яа-яЁё .'-]+$/.test(lines[0]) ? lines[0] : undefined;
    const emailLinks = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).slice(0, 3);
    return {
        identity: { name, links: emailLinks.length ? emailLinks : undefined },
        _extraction_mode: 'heuristic',
    };
}

export class KnowledgeOrchestrator {
    private kdb: KnowledgeDatabaseManager;
    private generateContentFn: GenFn | null = null;
    private liveCoachingFn: GenFn | null = null;
    private embedFn: EmbedFn | null = null;
    private embedQueryFn: EmbedFn | null = null;
    private customNotes = '';
    private knowledgeMode = false;

    public activeResume: { structured_data: StructuredProfileFacts } | null = null;
    public activeJD: { structured_data: StructuredJobFacts } | null = null;

    private companyEngine: CompanyResearchEngine | null = null;

    constructor(kdb: KnowledgeDatabaseManager) {
        this.kdb = kdb;
        // Restore any previously-ingested docs so grounding survives restart.
        try {
            const r = this.kdb.latestDoc(DocType.RESUME);
            if (r?.structured) this.activeResume = { structured_data: r.structured as StructuredProfileFacts };
            const j = this.kdb.latestDoc(DocType.JD);
            if (j?.structured) this.activeJD = { structured_data: j.structured as StructuredJobFacts };
            // A restored profile must be live immediately — the grounding gate in
            // IntelligenceEngine requires isKnowledgeMode(). knowledgeMode is not
            // itself persisted here, so derive it from the presence of a résumé.
            if (this.activeResume) this.knowledgeMode = true;
        } catch (e: any) {
            console.warn('[OSS-Knowledge] restore on boot failed (non-fatal):', e?.message);
        }
    }

    // ── Wiring setters (called by main.ts) ────────────────────────────────
    setGenerateContentFn(fn: GenFn): void { this.generateContentFn = fn; }
    setLiveCoachingContentFn(fn: GenFn): void { this.liveCoachingFn = fn; }
    setEmbedFn(fn: EmbedFn): void { this.embedFn = fn; }
    setEmbedQueryFn(fn: EmbedFn): void { this.embedQueryFn = fn; }
    setFastQueryEmbedFn(_fn: any): void { /* optional fast local path — not required for correctness */ }
    setActiveSpaceFn(_fn: any): void { /* single-embedder here; no cross-space migration needed */ }
    setConversationContextProvider(_fn: any): void { /* negotiation-only hint; unused in OSS build */ }
    async ensureEmbeddingSpace(): Promise<void> { /* embeddings are stored/compared in one space */ }
    setCustomNotes(text: string): void { this.customNotes = (text || '').trim(); }
    feedForDepthScoring(): void { /* premium depth-scoring telemetry — no-op */ }

    setKnowledgeMode(on: boolean): void { this.knowledgeMode = !!on; }
    isKnowledgeMode(): boolean { return this.knowledgeMode; }

    // ── Ingestion ─────────────────────────────────────────────────────────
    async ingestDocument(filePath: string, docType: DocType): Promise<{ success: boolean; error?: string; docType?: string }> {
        try {
            const rawText = await extractDocumentText(filePath);
            if (!rawText || rawText.length < 20) {
                return { success: false, error: 'Could not extract readable text from the file.' };
            }

            const isResume = docType === DocType.RESUME;
            let structured: StructuredProfileFacts | StructuredJobFacts | null = null;

            if (this.generateContentFn) {
                try {
                    const prompt = (isResume ? RESUME_EXTRACTION_PROMPT : JD_EXTRACTION_PROMPT) + rawText.slice(0, 24000);
                    const out = await this.generateContentFn([{ text: prompt }]);
                    const parsed = parseJsonLoose(out);
                    if (parsed && typeof parsed === 'object') {
                        structured = parsed;
                        (structured as any)._extraction_mode = 'llm';
                    }
                } catch (e: any) {
                    console.warn('[OSS-Knowledge] LLM extraction failed, falling back to heuristic:', e?.message);
                }
            }
            if (!structured && isResume) structured = heuristicResume(rawText);
            if (!structured) structured = { _extraction_mode: 'heuristic' } as any;

            const docId = `${docType}_${Date.now()}`;
            const createdAt = Date.now();
            // Replace any previous doc of this type (single active résumé/JD).
            this.kdb.deleteByType(docType);
            this.kdb.saveDoc({ id: docId, docType, fileName: require('path').basename(filePath), rawText, structured, createdAt });

            // Embed chunks for semantic grounding (best-effort — grounding still
            // works from structured facts if embeddings are unavailable).
            const chunks = chunkText(rawText);
            const rows: Array<{ ord: number; text: string; embedding: number[] | null }> = [];
            for (let i = 0; i < chunks.length; i++) {
                let emb: number[] | null = null;
                if (this.embedFn) {
                    try { emb = await this.embedFn(chunks[i]); } catch { emb = null; }
                }
                rows.push({ ord: i, text: chunks[i], embedding: emb });
            }
            this.kdb.saveChunks(docId, rows);

            if (isResume) this.activeResume = { structured_data: structured as StructuredProfileFacts };
            else this.activeJD = { structured_data: structured as StructuredJobFacts };

            this.knowledgeMode = true;
            return { success: true, docType };
        } catch (e: any) {
            console.error('[OSS-Knowledge] ingestDocument error:', e);
            return { success: false, error: e?.message || 'ingest_failed' };
        }
    }

    deleteDocumentsByType(docType: DocType): void {
        try { this.kdb.deleteByType(docType); } catch (e: any) { console.warn('[OSS-Knowledge] delete failed:', e?.message); }
        if (docType === DocType.RESUME) this.activeResume = null;
        if (docType === DocType.JD) this.activeJD = null;
    }

    // ── Grounding (the live answer path calls this) ───────────────────────
    async processQuestion(question: string): Promise<any | null> {
        if (!this.activeResume) return null;
        const facts = this.activeResume.structured_data;
        const jd = this.activeJD?.structured_data ?? undefined;
        const q = (question || '').trim();

        // Semantic retrieval over résumé chunks (top-K by cosine) — supplements
        // the structured evidence with verbatim excerpts for niche questions.
        let retrieved: string[] = [];
        try {
            if (this.embedQueryFn) {
                const qv = await this.embedQueryFn(q);
                const chunks = this.kdb.chunksForType(DocType.RESUME).filter((c) => c.embedding);
                const scored = chunks
                    .map((c) => ({ text: c.text, score: cosine(qv, c.embedding as number[]) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, RETRIEVE_TOP_K)
                    .filter((s) => s.score > 0.15);
                retrieved = scored.map((s) => s.text);
            }
        } catch (e: any) {
            console.warn('[OSS-Knowledge] retrieval failed (using structured facts only):', e?.message);
        }

        const name = facts.identity?.name;
        const role = facts.identity?.role;
        const isIntro = /\b(your name|who are you|introduce yourself|tell me about yourself|представ|как.*зовут|расскажите о себе)\b/i.test(q);

        // Build the contextBlock in the SAME `<profile_jit_evidence_request>`
        // format the app's own open fallback uses (IntelligenceEngine ~L1272), so
        // the WhatToAnswer prompt treats it as authoritative candidate evidence
        // instead of loose context. This is what makes the model actually state
        // the résumé facts (name/experience/metrics) rather than asking to clarify.
        let contextBlock = '';
        try {
            // Resolve relative to this compiled file (premium/electron/knowledge → electron/llm).
            const { selectManualProfileEvidence } = require('../../../electron/llm/manualProfileIntelligence');
            const { buildProfileJitPrompt } = require('../../../electron/llm/ProfileJitPromptBuilder');
            const evidence = selectManualProfileEvidence({
                question: q,
                profile: facts,
                jobDescription: jd,
                source: 'what_to_answer',
            });
            if (evidence) {
                const jit = buildProfileJitPrompt({
                    question: q,
                    answerType: evidence.answerType,
                    answerShape: evidence.answerShape,
                    sourceOwner: evidence.sourceOwner,
                    evidence,
                    maxAnswerWords: 110,
                });
                contextBlock = `<profile_jit_evidence_request>\n${jit.userPrompt}\n</profile_jit_evidence_request>`;
            }
        } catch (e: any) {
            console.warn('[OSS-Knowledge] JIT evidence builder unavailable, using plain facts:', e?.message);
        }

        // Fallback / supplement: always include a structured facts block (and any
        // semantic excerpts) so grounding still works if the JIT builder no-ops.
        const plain = this.buildContextBlock(facts, retrieved);
        contextBlock = contextBlock ? `${contextBlock}\n${plain}` : plain;

        return {
            factualRecall: true,
            liveNegotiationResponse: null,
            contextBlock,
            isIntroQuestion: isIntro,
            introResponse: isIntro && name
                ? `Меня зовут ${name}${role ? `, ${role}` : ''}.`
                : '',
        };
    }

    private buildContextBlock(facts: StructuredProfileFacts, retrieved: string[]): string {
        const parts: string[] = [
            '<candidate_profile source="resume">',
            // Directive so the model answers AS the candidate, not about them.
            'These are YOUR OWN facts from YOUR résumé. Answer the interviewer in the',
            'FIRST PERSON ("I", "my", "в моём проекте", "я внедрил"). Use the concrete',
            'facts, numbers and metrics below verbatim (e.g. exact percentages, request',
            'volumes, company names). Never say "the candidate", "по резюме", "обычно",',
            'or "у меня нет данных" — this IS your data. Do not invent anything beyond it.',
            '---',
        ];
        if (facts.identity?.name) parts.push(`Name: ${facts.identity.name}`);
        if (facts.identity?.role) parts.push(`Current/target role: ${facts.identity.role}`);
        if (facts.identity?.location) parts.push(`Location: ${facts.identity.location}`);
        if (facts.identity?.summary) parts.push(`Summary: ${facts.identity.summary}`);
        if (Array.isArray(facts.skills) && facts.skills.length) parts.push(`Skills: ${facts.skills.slice(0, 30).join(', ')}`);
        if (Array.isArray(facts.experience) && facts.experience.length) {
            parts.push('Experience:');
            for (const e of facts.experience.slice(0, 6)) {
                const head = [e.role, e.company, e.dates].filter(Boolean).join(' — ');
                parts.push(`- ${head}`);
                for (const h of (e.highlights || []).slice(0, 4)) parts.push(`    • ${h}`);
            }
        }
        if (Array.isArray(facts.projects) && facts.projects.length) {
            parts.push('Projects:');
            for (const p of facts.projects.slice(0, 5)) {
                const tech = Array.isArray(p.technologies) && p.technologies.length ? ` [${p.technologies.join(', ')}]` : '';
                parts.push(`- ${[p.name, p.description].filter(Boolean).join(': ')}${tech}`);
            }
        }
        if (Array.isArray(facts.education) && facts.education.length) {
            parts.push('Education:');
            for (const ed of facts.education.slice(0, 4)) {
                parts.push(`- ${[ed.degree, ed.institution, ed.year].filter(Boolean).join(', ')}`);
            }
        }
        if (this.customNotes) parts.push(`Additional notes: ${this.customNotes}`);
        if (retrieved.length) {
            parts.push('Relevant résumé excerpts:');
            for (const r of retrieved) parts.push(`"""${r.trim()}"""`);
        }
        parts.push('</candidate_profile>');
        return parts.join('\n');
    }

    // ── Status / data getters (UI) ────────────────────────────────────────
    getStatus(): any {
        const facts = this.activeResume?.structured_data;
        const experience = Array.isArray(facts?.experience) ? facts!.experience : [];
        return {
            hasResume: Boolean(this.activeResume),
            hasJD: Boolean(this.activeJD),
            activeMode: this.knowledgeMode,
            resumeSummary: facts
                ? {
                      name: facts.identity?.name,
                      role: facts.identity?.role,
                      totalExperienceYears: this.estimateYears(experience),
                  }
                : undefined,
        };
    }

    private estimateYears(experience: any[]): number | undefined {
        // Best-effort: sum year spans found in `dates` strings (e.g. "2019–2023").
        let total = 0;
        for (const e of experience) {
            const m = String(e?.dates || '').match(/(\d{4})\s*[–—-]\s*(\d{4}|present|now|наст)/i);
            if (m) {
                const start = parseInt(m[1], 10);
                const end = /^\d{4}$/.test(m[2]) ? parseInt(m[2], 10) : new Date().getFullYear();
                if (end >= start) total += end - start;
            }
        }
        return total > 0 ? total : undefined;
    }

    getProfileData(): any {
        return {
            activeResume: this.activeResume?.structured_data ?? null,
            activeJD: this.activeJD?.structured_data ?? null,
            customNotes: this.customNotes,
            knowledgeMode: this.knowledgeMode,
        };
    }

    // ── Company research ──────────────────────────────────────────────────
    getCompanyResearchEngine(): CompanyResearchEngine {
        if (!this.companyEngine) {
            this.companyEngine = new CompanyResearchEngine(
                this.generateContentFn || (async () => ''),
            );
        }
        return this.companyEngine;
    }

    // ── Negotiation (salary coaching) — minimal open surface ──────────────
    // The upstream premium coaching layer is not reproduced; these keep the
    // handlers safe and return honest "not available" states rather than
    // fabricating salary advice (which the app is explicitly careful about).
    getNegotiationScript(): any { return null; }
    async generateNegotiationScriptOnDemand(): Promise<any> { return null; }
    getNegotiationTracker(): any { return { hasSignals: false, signals: [] }; }
    resetNegotiationSession(): void { /* no persistent negotiation state in OSS build */ }
}
