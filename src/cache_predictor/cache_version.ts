/**
 * Inlined from @actions/toolkit's packages/cache/src/internal/cacheUtils.ts
 * (MIT License — Copyright (c) 2018 GitHub, Inc. and contributors).
 *
 * The runner uses this exact algorithm to compute the `version` field in
 * Twirp CreateCacheEntry / GetCacheEntryDownloadURL requests, so we must
 * match it byte-for-byte for cache key prediction to work.
 */

import * as crypto from 'crypto';

const VERSION_SALT = '1.0';

export function getCacheVersion(
    paths: string[],
    compressionMethod?: string,
    enableCrossOsArchive = false
): string {
    const components = paths.slice();

    if (compressionMethod) {
        components.push(compressionMethod);
    }

    if (process.platform === 'win32' && !enableCrossOsArchive) {
        components.push('windows-only');
    }

    components.push(VERSION_SALT);

    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
}
