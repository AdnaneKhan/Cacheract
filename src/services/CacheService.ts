import * as fs from 'fs';
import { FinalizeCacheEntryUploadRequest, FinalizeCacheEntryUploadResponse, CreateCacheEntryRequest, GetCacheEntryDownloadURLRequest } from '@actions/cache/lib/generated/results/api/v1/cache';
import { UploadOptions, DownloadOptions } from '@actions/cache/lib/options';

// These are internal modules, so we use require
const cacheTwirpClient = require('@actions/cache/lib/internal/shared/cacheTwirpClient');
const cacheHttpClient = require('@actions/cache/lib/internal/cacheHttpClient');

export class CacheService {

    async setEntry(archive: string, key: string, version: string, runtimeToken: string): Promise<boolean> {
        try {
            if (!runtimeToken) {
                console.error('Runtime token is missing');
                return false;
            }
            if (!fs.existsSync(archive)) {
                console.error(`Archive file does not exist at path: ${archive}`);
                return false;
            }
            const stats = fs.statSync(archive);
            const archiveFileSize = stats.size;
            const request: CreateCacheEntryRequest = { key, version };
            process.env['ACTIONS_RESULTS_URL'] = 'https://results-receiver.actions.githubusercontent.com';
            process.env['ACTIONS_RUNTIME_TOKEN'] = runtimeToken;
            const twirpClient = cacheTwirpClient.internalCacheTwirpClient();
            const response = await twirpClient.CreateCacheEntry(request);
            const options: UploadOptions = { useAzureSdk: true };
            if (response.ok) {
                await cacheHttpClient.saveCache(-1, archive, response.signedUploadUrl, options);
                console.log('Cache entry created successfully:', response.data);
                const finalizeRequest: FinalizeCacheEntryUploadRequest = { key, version, sizeBytes: `${archiveFileSize}` };
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

    async retrieveEntry(cache_key: string, cache_version: string, runtimeToken: string): Promise<string> {
        try {
            // The ACTIONS_RUNTIME_TOKEN to retrieve the cache.
            if (!runtimeToken) {
                return '';
            }

            console.log("Retrieving cache entry...");

            process.env['ACTIONS_CACHE_URL'] = 'https://results-receiver.actions.githubusercontent.com';
            process.env['ACTIONS_RUNTIME_TOKEN'] = runtimeToken;
            const request: GetCacheEntryDownloadURLRequest = {
                key: cache_key,
                restoreKeys: [],
                version: cache_version
            }

            const twirpClient = cacheTwirpClient.internalCacheTwirpClient();

            const response = await twirpClient.GetCacheEntryDownloadURL(request)
            const options: DownloadOptions = {
                useAzureSdk: true
            }
            if (response.ok) {
                await cacheHttpClient.downloadCache(response.signedDownloadUrl, '/tmp/cacheract.tar.tzstd', options);
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
}
