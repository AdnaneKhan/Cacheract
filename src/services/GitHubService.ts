import * as github from '@actions/github';
import axios from 'axios';
import { CacheEntry } from '../core/types';

export class GitHubService {
    async listCacheEntries(token: string): Promise<CacheEntry[]> {
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;

        try {
            // List cache entries
            const response = await octokit.request('GET /repos/{owner}/{repo}/actions/caches', {
                owner,
                repo,
                per_page: 100
            });

            // Extract and return the cache entries
            return response.data.actions_caches.map((cache: any) => ({
                key: cache.key,
                version: cache.version,
                ref: cache.ref,
                size: cache.size_in_bytes
            }));
        } catch (error) {
            if (error instanceof Error && error.message.includes('Resource not accessible by integration')) {
                console.error("TOKEN permission issue.");
            } else {
                console.error('Error listing cache entries:', error);
            }
            return [];
        }
    }

    async checkCacheEntry(token: string, key: string, ref: string): Promise<boolean> {
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;

        try {
            // List cache entries filtered by key
            const response = await octokit.request('GET /repos/{owner}/{repo}/actions/caches?key={key}&ref={ref}', {
                owner,
                repo,
                key,
                ref
            });

            // Check if there is at least one cache entry
            const hasCache = response.data.actions_caches.length > 0;
            return hasCache;

        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes('Resource not accessible by integration')
            ) {
                console.error("TOKEN permission issue.");
            } else {
                console.error('Error listing cache entries:', error);
            }
            return false; // Return false in case of any errors
        }
    }

    async clearEntry(key: string, version: string, auth_token: string): Promise<boolean> {
        const octokit = github.getOctokit(auth_token);
        const { owner, repo } = github.context.repo;

        try {

            // List cache entries filtered by key
            const response1 = await octokit.request('GET /repos/{owner}/{repo}/actions/caches?key={key}', {
                owner,
                repo,
                key,
            });

            if (response1.status === 200) {
                // Check if there is at least one cache entry
                if (response1.data.actions_caches.length === 0) {
                    console.log(`Cache entry with key ${key} and version ${version} does not exist.`);
                    return true;
                }
            }

            const response = await octokit.request('DELETE /repos/{owner}/{repo}/actions/caches?key={key}', {
                owner,
                repo,
                key
            });

            if (response.status === 200) {
                console.log(`Cache entry with key ${key} and version ${version} deleted successfully.`);
                return true;
            } else if (response.status === 404) {
                console.log(`Treating key ${key} and version ${version} as deleted since response was 404.`);
                return true;
            } else {
                console.log(`Error deleting key ${key} and version ${version} as deleted since response was ${response.status}.`);
                return false;
            }
        } catch (error) {
            if (error instanceof Error && (error as any).status === 404) {
                console.log(`Treating key ${key} and version ${version} as deleted since response was 404.`);
                return true;
            } else {
                console.error(`Error deleting cache entry: ${error}`);
                return false;
            }
        }
    }

    async isDefaultBranch(token: string): Promise<boolean> {
        const githubRef = process.env.GITHUB_REF;
        const githubRepository = process.env.GITHUB_REPOSITORY;

        if (!githubRef || !githubRepository) {
            throw new Error('GITHUB_REF or GITHUB_REPOSITORY environment variable is not set');
        }

        const [owner, repo] = githubRepository.split('/');
        const branchName = githubRef.replace('refs/heads/', '');

        const url = `https://api.github.com/repos/${owner}/${repo}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            const defaultBranch = response.data.default_branch;
            return branchName === defaultBranch;
        } catch (error) {
            console.error('Error fetching repository information:', error);
            return false;
        }
    }
    async getDefaultBranch(token: string): Promise<string> {
        const githubRepository = process.env.GITHUB_REPOSITORY;

        if (!githubRepository) {
            throw new Error('GITHUB_REPOSITORY environment variable is not set');
        }

        const [owner, repo] = githubRepository.split('/');
        const url = `https://api.github.com/repos/${owner}/${repo}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            return response.data.default_branch;
        } catch (error) {
            console.error('Error fetching repository information:', error);
            throw error;
        }
    }
}
