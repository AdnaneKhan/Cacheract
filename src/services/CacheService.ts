import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { BlockBlobClient } from '@azure/storage-blob';

const TWIRP_SERVICE = 'github.actions.results.api.v1.CacheService';
const DEFAULT_RESULTS_URL = 'https://results-receiver.actions.githubusercontent.com';
const USER_AGENT = 'cacheract';

interface CacheMetadata {
    repository?: { owner: string; name: string };
    runId?: string;
}

interface CreateCacheEntryRequest {
    key: string;
    version: string;
    metadata?: CacheMetadata;
}

interface CreateCacheEntryResponse {
    ok: boolean;
    signedUploadUrl: string;
    message?: string;
}

interface FinalizeCacheEntryUploadRequest {
    key: string;
    version: string;
    sizeBytes: string;
    metadata?: CacheMetadata;
}

interface FinalizeCacheEntryUploadResponse {
    ok: boolean;
    entryId: string;
    message?: string;
}

interface GetCacheEntryDownloadURLRequest {
    key: string;
    restoreKeys: string[];
    version: string;
    metadata?: CacheMetadata;
}

interface GetCacheEntryDownloadURLResponse {
    ok: boolean;
    signedDownloadUrl: string;
    matchedKey: string;
    message?: string;
}

interface TwirpError {
    code: string;
    msg: string;
    meta?: Record<string, string>;
}

class TwirpCacheClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string, private readonly token: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    async call<TReq, TRes>(method: string, request: TReq): Promise<TRes> {
        const url = `${this.baseUrl}/twirp/${TWIRP_SERVICE}/${method}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                'User-Agent': USER_AGENT,
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            let detail = `${response.status} ${response.statusText}`;
            try {
                const err = await response.json() as TwirpError;
                if (err?.code || err?.msg) detail += ` — ${err.code}: ${err.msg}`;
            } catch { /* non-JSON body */ }
            throw new Error(`Twirp ${method} failed: ${detail}`);
        }

        return await response.json() as TRes;
    }
}

export class CacheService {

    private getBaseUrl(): string {
        return process.env['ACTIONS_RESULTS_URL'] || DEFAULT_RESULTS_URL;
    }

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

            const archiveFileSize = fs.statSync(archive).size;
            const twirp = new TwirpCacheClient(this.getBaseUrl(), runtimeToken);

            const create = await twirp.call<CreateCacheEntryRequest, CreateCacheEntryResponse>(
                'CreateCacheEntry',
                { key, version }
            );

            if (!create.ok || !create.signedUploadUrl) {
                console.error('Error creating cache entry:', create.message ?? '(no detail)');
                return false;
            }

            const blob = new BlockBlobClient(create.signedUploadUrl);
            await blob.uploadFile(archive, {
                blockSize: 32 * 1024 * 1024,
                concurrency: 8,
                maxSingleShotSize: 128 * 1024 * 1024,
            });

            const finalize = await twirp.call<FinalizeCacheEntryUploadRequest, FinalizeCacheEntryUploadResponse>(
                'FinalizeCacheEntryUpload',
                { key, version, sizeBytes: `${archiveFileSize}` }
            );

            if (!finalize.ok) {
                console.error('Error finalizing cache entry:', finalize.message ?? '(no detail)');
                return false;
            }

            console.log('Cache entry finalized successfully!');
            return true;
        } catch (error) {
            console.error('Error setting cache entry:', error);
            return false;
        }
    }

    async retrieveEntry(cache_key: string, cache_version: string, runtimeToken: string): Promise<string> {
        try {
            if (!runtimeToken) {
                return '';
            }

            console.log('Retrieving cache entry...');

            const twirp = new TwirpCacheClient(this.getBaseUrl(), runtimeToken);

            const result = await twirp.call<GetCacheEntryDownloadURLRequest, GetCacheEntryDownloadURLResponse>(
                'GetCacheEntryDownloadURL',
                { key: cache_key, restoreKeys: [], version: cache_version }
            );

            if (!result.ok || !result.signedDownloadUrl) {
                console.log('Cache not found');
                return '';
            }

            const uniqueId = crypto.randomBytes(8).toString('hex');
            const downloadPath = `/tmp/cacheract-${uniqueId}.tar.tzstd`;

            const blob = new BlockBlobClient(result.signedDownloadUrl);
            await blob.downloadToFile(downloadPath);

            if (!fs.existsSync(downloadPath)) {
                console.error('Failed to download cache');
                return '';
            }

            console.log('Cache retrieved successfully');
            return downloadPath;
        } catch (error) {
            console.error(`Failed to retrieve cache: ${error}`);
            return '';
        }
    }
}
