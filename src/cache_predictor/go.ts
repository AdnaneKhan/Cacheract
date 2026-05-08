/**
 *
 * The majority of code in this file is copied from the actions/setup-go repository
 * at https://github.com/actions/setup-go.
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
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { getCacheVersion } from './cache_version';

const execFileAsync = promisify(execFile);

export const CACHE_KEY_PREFIX = 'setup-go';

export interface GoPackageManagerInfo {
    dependencyFilePattern: string;
    cacheFolderCommandList: string[];
}

export const supportedPackageManagers: { [k: string]: GoPackageManagerInfo } = {
    default: {
        dependencyFilePattern: 'go.mod',
        cacheFolderCommandList: ['go env GOMODCACHE', 'go env GOCACHE']
    }
};

export interface GoCacheConfig {
    versionSpec: string;
    cacheDependencyPath?: string;
    /**
     * Optional override for the package manager key in {@link supportedPackageManagers}.
     * setup-go currently only supports `default`.
     */
    packageManager?: string;
}

export const getGoPackageManagerInfo = (
    packageManager: string = 'default'
): GoPackageManagerInfo => {
    const info = supportedPackageManagers[packageManager];
    if (!info) {
        throw new Error(
            `It's not possible to use ${packageManager}, please, check correctness of the package manager name spelling.`
        );
    }
    return info;
};

const getCommandOutput = async (toolCommand: string): Promise<string> => {
    const [cmd, ...args] = toolCommand.trim().split(/\s+/);
    try {
        const { stdout } = await execFileAsync(cmd, args);
        return stdout.trim();
    } catch (err: any) {
        const stderr = (err.stderr ?? '').toString().trim();
        const exitCode = err.code ?? err.signal ?? 'unknown';
        throw new Error(
            stderr || `The '${toolCommand}' command failed with exit code: ${exitCode}`
        );
    }
};

export const getGoCacheDirectoryPath = async (
    packageManagerInfo: GoPackageManagerInfo
): Promise<string[]> => {
    const pathOutputs = await Promise.allSettled(
        packageManagerInfo.cacheFolderCommandList.map(async command =>
            getCommandOutput(command)
        )
    );

    const cachePaths = pathOutputs
        .map(item => (item.status === 'fulfilled' ? item.value : ''))
        .filter(Boolean);

    if (!cachePaths.length) {
        throw new Error('Could not get cache folder paths.');
    }

    return cachePaths;
};

export const findGoDependencyFile = (
    packageManagerInfo: GoPackageManagerInfo
): string => {
    const dependencyFile = packageManagerInfo.dependencyFilePattern;
    const workspace = process.env.GITHUB_WORKSPACE!;
    const rootContent = fs.readdirSync(workspace);

    if (!rootContent.includes(dependencyFile)) {
        throw new Error(
            `Dependencies file is not found in ${workspace}. Supported file pattern: ${dependencyFile}`
        );
    }

    return path.join(workspace, dependencyFile);
};

export async function computeGoPrimaryKey(
    config: GoCacheConfig
): Promise<string> {
    const packageManagerInfo = getGoPackageManagerInfo(config.packageManager);

    const dependencyFilePath = config.cacheDependencyPath
        ? config.cacheDependencyPath
        : findGoDependencyFile(packageManagerInfo);

    const fileHash = await glob.hashFiles(dependencyFilePath);
    if (!fileHash) {
        throw new Error(
            'Some specified paths were not resolved, unable to cache dependencies.'
        );
    }

    const platform = process.env.RUNNER_OS;
    const arch = process.arch;
    // setup-go segregates Linux caches by ImageOS so distro-specific binaries do not collide.
    const linuxVersion =
        process.env.RUNNER_OS === 'Linux' ? `${process.env.ImageOS}-` : '';

    return `${CACHE_KEY_PREFIX}-${platform}-${arch}-${linuxVersion}go-${config.versionSpec}-${fileHash}`;
}

export async function getGoCache(
    config: GoCacheConfig
): Promise<{ key: string; version: string; paths: string[] }> {
    const packageManagerInfo = getGoPackageManagerInfo(config.packageManager);

    const key = await computeGoPrimaryKey(config);
    const paths = await getGoCacheDirectoryPath(packageManagerInfo);

    const version = getCacheVersion(paths, 'zstd-without-long');

    return { key, version, paths };
}
