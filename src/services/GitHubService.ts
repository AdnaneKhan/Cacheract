import { CacheEntry } from '../core/types';

const API_BASE = 'https://api.github.com';
const USER_AGENT = 'cacheract';

interface RepoContext {
    owner: string;
    repo: string;
}

interface CachesListResponse {
    total_count: number;
    actions_caches: Array<{
        key: string;
        version: string;
        ref: string;
        size_in_bytes: number;
    }>;
}

interface RepoInfoResponse {
    default_branch: string;
}

function getRepoContext(): RepoContext {
    const githubRepository = process.env.GITHUB_REPOSITORY;
    if (!githubRepository) {
        throw new Error('GITHUB_REPOSITORY environment variable is not set');
    }
    const [owner, repo] = githubRepository.split('/');
    return { owner, repo };
}

function buildHeaders(token: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
    };
}

function isPermissionError(status: number): boolean {
    return status === 401 || status === 403;
}

export class GitHubService {
    async listCacheEntries(token: string): Promise<CacheEntry[]> {
        const { owner, repo } = getRepoContext();
        try {
            const url = `${API_BASE}/repos/${owner}/${repo}/actions/caches?per_page=100`;
            const response = await fetch(url, { method: 'GET', headers: buildHeaders(token) });

            if (!response.ok) {
                if (isPermissionError(response.status)) {
                    console.error('TOKEN permission issue.');
                } else {
                    console.error(`Error listing cache entries: ${response.status} ${response.statusText}`);
                }
                return [];
            }

            const data = await response.json() as CachesListResponse;
            return data.actions_caches.map(cache => ({
                key: cache.key,
                version: cache.version,
                ref: cache.ref,
                size: cache.size_in_bytes,
            }));
        } catch (error) {
            console.error('Error listing cache entries:', error);
            return [];
        }
    }

    async checkCacheEntry(token: string, key: string, ref: string): Promise<boolean> {
        const { owner, repo } = getRepoContext();
        try {
            const params = new URLSearchParams({ key, ref });
            const url = `${API_BASE}/repos/${owner}/${repo}/actions/caches?${params}`;
            const response = await fetch(url, { method: 'GET', headers: buildHeaders(token) });

            if (!response.ok) {
                if (isPermissionError(response.status)) {
                    console.error('TOKEN permission issue.');
                } else {
                    console.error(`Error checking cache entry: ${response.status} ${response.statusText}`);
                }
                return false;
            }

            const data = await response.json() as CachesListResponse;
            return data.actions_caches.length > 0;
        } catch (error) {
            console.error('Error checking cache entry:', error);
            return false;
        }
    }

    async clearEntry(key: string, version: string, auth_token: string): Promise<boolean> {
        const { owner, repo } = getRepoContext();
        try {
            const params = new URLSearchParams({ key });
            const cachesUrl = `${API_BASE}/repos/${owner}/${repo}/actions/caches?${params}`;

            const listResponse = await fetch(cachesUrl, { method: 'GET', headers: buildHeaders(auth_token) });
            if (listResponse.ok) {
                const data = await listResponse.json() as CachesListResponse;
                if (data.actions_caches.length === 0) {
                    console.log(`Cache entry with key ${key} and version ${version} does not exist.`);
                    return true;
                }
            }

            const deleteResponse = await fetch(cachesUrl, { method: 'DELETE', headers: buildHeaders(auth_token) });

            if (deleteResponse.status === 200 || deleteResponse.status === 204) {
                console.log(`Cache entry with key ${key} and version ${version} deleted successfully.`);
                return true;
            }
            if (deleteResponse.status === 404) {
                console.log(`Treating key ${key} and version ${version} as deleted since response was 404.`);
                return true;
            }
            console.log(`Error deleting key ${key} and version ${version}; response was ${deleteResponse.status}.`);
            return false;
        } catch (error) {
            console.error(`Error deleting cache entry: ${error}`);
            return false;
        }
    }

    async isDefaultBranch(token: string): Promise<boolean> {
        const githubRef = process.env.GITHUB_REF;
        if (!githubRef) {
            throw new Error('GITHUB_REF environment variable is not set');
        }
        const branchName = githubRef.replace('refs/heads/', '');
        try {
            const defaultBranch = await this.getDefaultBranch(token);
            return branchName === defaultBranch;
        } catch {
            return false;
        }
    }

    async getDefaultBranch(token: string): Promise<string> {
        const { owner, repo } = getRepoContext();
        const url = `${API_BASE}/repos/${owner}/${repo}`;

        try {
            const response = await fetch(url, { method: 'GET', headers: buildHeaders(token) });

            if (!response.ok) {
                throw new Error(`Failed to fetch repository info: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as RepoInfoResponse;
            return data.default_branch;
        } catch (error) {
            console.error('Error fetching repository information:', error);
            throw error;
        }
    }
}
