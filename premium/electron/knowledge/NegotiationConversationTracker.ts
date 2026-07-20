/**
 * OPEN re-implementation of the premium NegotiationConversationTracker's public
 * `textHasCompEvidence` helper (the only symbol the app imports from it).
 *
 * Used by electron/main.ts to hint whether the last interviewer turns mention
 * compensation, so salary topics aren't accidentally pulled into unrelated
 * answers. A conservative keyword/number heuristic — no proprietary code.
 */

const COMP_PATTERNS: RegExp[] = [
    /\b(salary|compensation|comp\b|pay|package|base|bonus|equity|rsus?|stock options?|offer|raise|relocation)\b/i,
    /\b(зарплат|оклад|компенсац|вилк|бонус|опцион|оффер|доход|ставк)/i,
    /\b(\$|€|£|₽|usd|eur|rub)\s?\d/i,
    /\b\d{2,3}\s?(k|тыс|000)\b/i,
    /\bper (year|month|annum)\b|\bв (год|месяц)\b/i,
];

export function textHasCompEvidence(text: string): boolean {
    const t = (text || '').trim();
    if (!t) return false;
    return COMP_PATTERNS.some((re) => re.test(t));
}
