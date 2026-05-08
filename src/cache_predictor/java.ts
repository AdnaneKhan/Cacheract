/**
 *
 * The majority of code in this file is copied from the actions/setup-java repository
 * at https://github.com/actions/setup-java.
 *
 * * The MIT License (MIT)
 * Copyright (c) 2018 GitHub, Inc. and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

import * as glob from '@actions/glob';
import * as os from 'os';
import { join } from 'path';
import { getCacheVersion } from './cache_version';

export const CACHE_KEY_PREFIX = 'setup-java';

export type JavaPackageManagerId = 'maven' | 'gradle' | 'sbt';

export interface JavaPackageManager {
    id: JavaPackageManagerId;
    /** Paths cached on disk for this build tool. */
    path: string[];
    /** Default glob patterns hashed into the primary key when no override is given. */
    pattern: string[];
}

export interface JavaCacheConfig {
    id: JavaPackageManagerId;
    cacheDependencyPath?: string;
}

function getCoursierCachePath(): string {
    if (os.type() === 'Linux') return join(os.homedir(), '.cache', 'coursier');
    if (os.type() === 'Darwin')
        return join(os.homedir(), 'Library', 'Caches', 'Coursier');
    return join(os.homedir(), 'AppData', 'Local', 'Coursier', 'Cache');
}

export const supportedPackageManager: JavaPackageManager[] = [
    {
        id: 'maven',
        path: [join(os.homedir(), '.m2', 'repository')],
        pattern: ['**/pom.xml']
    },
    {
        id: 'gradle',
        path: [
            join(os.homedir(), '.gradle', 'caches'),
            join(os.homedir(), '.gradle', 'wrapper')
        ],
        pattern: [
            '**/*.gradle*',
            '**/gradle-wrapper.properties',
            'buildSrc/**/Versions.kt',
            'buildSrc/**/Dependencies.kt',
            'gradle/*.versions.toml',
            '**/versions.properties'
        ]
    },
    {
        id: 'sbt',
        path: [
            join(os.homedir(), '.ivy2', 'cache'),
            join(os.homedir(), '.sbt'),
            getCoursierCachePath(),
            // Some files should not be cached to avoid resolution problems.
            // In particular the resolution of snapshots (ideological gap between maven/ivy).
            '!' + join(os.homedir(), '.sbt', '*.lock'),
            '!' + join(os.homedir(), '**', 'ivydata-*.properties')
        ],
        pattern: [
            '**/*.sbt',
            '**/project/build.properties',
            '**/project/**.scala',
            '**/project/**.sbt'
        ]
    }
];

export function findJavaPackageManager(id: string): JavaPackageManager {
    const packageManager = supportedPackageManager.find(pm => pm.id === id);
    if (!packageManager) {
        throw new Error(`unknown package manager specified: ${id}`);
    }
    return packageManager;
}

export async function computeJavaCacheKey(
    packageManager: JavaPackageManager,
    cacheDependencyPath?: string
): Promise<string> {
    const pattern = cacheDependencyPath
        ? cacheDependencyPath.trim().split('\n')
        : packageManager.pattern;

    const fileHash = await glob.hashFiles(pattern.join('\n'));
    if (!fileHash) {
        throw new Error(
            `No file in ${process.cwd()} matched to [${pattern}], make sure you have checked out the target repository`
        );
    }

    return `${CACHE_KEY_PREFIX}-${process.env['RUNNER_OS']}-${process.arch}-${packageManager.id}-${fileHash}`;
}

export async function getJavaCache(
    config: JavaCacheConfig
): Promise<{ key: string; version: string; paths: string[] }> {
    const packageManager = findJavaPackageManager(config.id);

    const key = await computeJavaCacheKey(
        packageManager,
        config.cacheDependencyPath
    );

    const paths = packageManager.path;

    const version = getCacheVersion(paths, 'zstd-without-long');

    return { key, version, paths };
}
