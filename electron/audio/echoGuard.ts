/**
 * EchoGuard — cross-channel echo suppression for the dual STT pipeline.
 *
 * On machines without hardware echo cancellation, the microphone picks up
 * whatever the speakers are playing (podcast, Zoom remote party). Both
 * channels then transcribe the SAME audio: the system channel correctly
 * attributes it to the interviewer, while the mic channel attributes it to
 * the user. The AI then treats interviewer questions as the user's own
 * speech and "answers its own questions".
 *
 * The guard works at the text level: it remembers recent interviewer final
 * transcripts and flags user-channel finals whose tokens are almost entirely
 * contained in that window. The two channels decode the same audio with
 * slightly different results, so matching is token-set containment, not
 * string equality. When the user wears headphones nothing ever matches and
 * the guard is a no-op.
 *
 * Ordering caveat: the mic final can arrive BEFORE the matching system final
 * (both decode independently). Callers should therefore quarantine user
 * finals for a few seconds before consulting the guard — see the
 * USER_FINAL_QUARANTINE_MS constant and its use in main.ts.
 */

export const USER_FINAL_QUARANTINE_MS = 3500;

/** Lowercase, strip punctuation, split into tokens of length >= 2. */
export function echoTokens(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2);
}

interface WindowEntry {
    tokens: string[];
    ts: number;
}

export class EchoGuard {
    /** How long interviewer text stays eligible for echo matching. */
    private static readonly WINDOW_MS = 30_000;
    /** User utterances shorter than this are never treated as echo —
     *  short acknowledgements ("да", "угу", "okay so") legitimately reuse
     *  the interviewer's words. */
    private static readonly MIN_TOKENS = 4;
    /** Fraction of user tokens that must appear in the interviewer window. */
    private static readonly THRESHOLD = 0.6;
    private static readonly MAX_ENTRIES = 40;

    private interviewerWindow: WindowEntry[] = [];

    reset(): void {
        this.interviewerWindow = [];
    }

    noteInterviewerFinal(text: string, ts: number = Date.now()): void {
        const tokens = echoTokens(text);
        if (tokens.length === 0) return;
        this.interviewerWindow.push({ tokens, ts });
        this.prune(ts);
    }

    /**
     * True when `text` (a user-channel final) is almost certainly the
     * speakers bleeding into the microphone rather than the user talking.
     */
    isUserEcho(text: string, now: number = Date.now()): boolean {
        this.prune(now);
        const tokens = echoTokens(text);
        if (tokens.length < EchoGuard.MIN_TOKENS) return false;
        if (this.interviewerWindow.length === 0) return false;

        const hay = new Set<string>();
        for (const entry of this.interviewerWindow) {
            for (const t of entry.tokens) hay.add(t);
        }

        let hits = 0;
        for (const t of tokens) {
            if (hay.has(t)) hits++;
        }
        return hits / tokens.length >= EchoGuard.THRESHOLD;
    }

    private prune(now: number): void {
        const cutoff = now - EchoGuard.WINDOW_MS;
        if (this.interviewerWindow.length > EchoGuard.MAX_ENTRIES) {
            this.interviewerWindow = this.interviewerWindow.slice(-EchoGuard.MAX_ENTRIES);
        }
        while (this.interviewerWindow.length > 0 && this.interviewerWindow[0].ts < cutoff) {
            this.interviewerWindow.shift();
        }
    }
}
