
export interface Replacement {
    FILE_PATH: string;
    FILE_CONTENT?: string;
    FILE_URL?: string;
}

export type ManualCacheEntry = {
    key: string;
    version: string;
}

export interface CacheEntry {
    key: string;
    version: string;
    ref: string;
    size: number;
}

export interface ActionDetails {
    path: string;
    yml: string;
    js: string;
}

export type RunnerEnvironment = {
    github_hosted: boolean;
    os: 'Linux' | 'Windows' | 'Darwin' | 'Unknown';
}

export interface RunnerContext {
    os: string;
    isGitHubHosted: boolean;
}
