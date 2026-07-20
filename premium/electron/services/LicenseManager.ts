/**
 * OPEN LicenseManager for local personal-use operation.
 *
 * The upstream premium LicenseManager validated a paid subscription against
 * Natively's server. That module is absent from this fork; every handler that
 * required it fell into a catch and disabled premium surfaces. On the owner's
 * own machine, under the Personal Use Source License (which permits local,
 * non-commercial modification), this stand-in reports premium so the features
 * whose code exists in this open tree are usable. It performs NO server calls
 * and validates nothing remotely. Contains no proprietary code.
 */

import { createHash } from 'crypto';
import { hostname, platform, arch, cpus } from 'os';

let _instance: LicenseManager | null = null;

export class LicenseManager {
    static getInstance(): LicenseManager {
        if (!_instance) _instance = new LicenseManager();
        return _instance;
    }

    isPremium(): boolean { return true; }
    async isPremiumAsync(): Promise<boolean> { return true; }

    getLicenseDetails(): { isPremium: boolean; plan?: string; provider?: string } {
        return { isPremium: true, plan: 'personal-unlock', provider: 'local' };
    }

    /** Stable, non-identifying machine fingerprint (used only where a HWID
     *  string is expected; never sent anywhere in this build). */
    getHardwareId(): string {
        try {
            const seed = `${hostname()}|${platform()}|${arch()}|${(cpus()[0]?.model || '')}`;
            return createHash('sha256').update(seed).digest('hex').slice(0, 32);
        } catch {
            return 'local-machine';
        }
    }

    async activateLicense(_key: string): Promise<{ success: boolean; error?: string }> {
        // Nothing to validate locally — treat as already active.
        return { success: true };
    }

    async activateWithApiKey(_apiKey: string): Promise<{ success: boolean; error?: string }> {
        return { success: true };
    }

    deactivate(): { success: boolean } {
        return { success: true };
    }
}
