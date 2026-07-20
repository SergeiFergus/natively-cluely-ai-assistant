/**
 * OPEN re-implementation of the premium knowledge module's shared types.
 *
 * The upstream `premium/` bundle is closed-source and absent from this fork,
 * so every `require('../premium/electron/knowledge/...')` in the app threw and
 * disabled Profile Intelligence entirely. These open modules restore the
 * feature on the owner's own machine using their own API keys — no upstream
 * license, no server dependency. Authored from scratch against the public
 * call-sites in electron/ipcHandlers.ts and electron/main.ts; contains no
 * proprietary code.
 */

export enum DocType {
    RESUME = 'resume',
    JD = 'jd',
    OTHER = 'other',
}

/** Structured résumé facts — mirrors the shape consumed by
 *  electron/llm/manualProfileIntelligence.ts (identity/skills/experience/
 *  projects/education). All fields optional; absent = not stated in the doc. */
export interface StructuredProfileFacts {
    identity?: {
        name?: string;
        role?: string;
        location?: string;
        summary?: string;
        links?: string[];
    };
    skills?: string[];
    experience?: Array<{
        role?: string;
        company?: string;
        dates?: string;
        location?: string;
        highlights?: string[];
    }>;
    projects?: Array<{
        name?: string;
        description?: string;
        technologies?: string[];
    }>;
    education?: Array<{
        degree?: string;
        institution?: string;
        year?: string;
    }>;
    /** How the facts were produced — 'llm' (structured extraction) or
     *  'heuristic' (regex fallback when no LLM was reachable). Surfaced by the
     *  profile:get-status handler so the UI can offer a re-extract. */
    _extraction_mode?: 'llm' | 'heuristic';
}

export interface StructuredJobFacts {
    title?: string;
    company?: string;
    location?: string;
    level?: string;
    employment_type?: string;
    min_years_experience?: number | string;
    requirements?: string[];
    nice_to_haves?: string[];
    responsibilities?: string[];
    technologies?: string[];
    keywords?: string[];
    description_summary?: string;
    compensation_hint?: string;
    _extraction_mode?: 'llm' | 'heuristic';
}

export interface KnowledgeDocRecord {
    id: string;
    docType: DocType;
    fileName: string;
    rawText: string;
    structured: StructuredProfileFacts | StructuredJobFacts | null;
    createdAt: number;
}
