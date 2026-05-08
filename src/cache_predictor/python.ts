/**
 *
 * The majority of code in this file is copied from the actions/setup-python repository
 * at https://github.com/actions/setup-python.
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
import * as os from 'os';

const execFileAsync = promisify(execFile);

export const CACHE_DEPENDENCY_BACKUP_PATH = '**/pyproject.toml';
export const CACHE_KEY_PREFIX = 'setup-python';

export type PythonPackageManager = 'pip' | 'pipenv' | 'poetry';

export interface PythonCacheConfig {
    package_manager: PythonPackageManager;
    pythonVersion: string;
    cacheDependencyPath?: string;
}

const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

const DEFAULT_DEPENDENCY_PATTERNS: Record<PythonPackageManager, string> = {
    pip: '**/requirements.txt',
    pipenv: '**/Pipfile.lock',
    poetry: '**/poetry.lock'
};

interface LinuxOSInfo {
    osName: string;
    osVersion: string;
}

export async function getLinuxInfo(): Promise<LinuxOSInfo> {
    const { stdout } = await execFileAsync('lsb_release', ['-i', '-r', '-s']);

    const [osName, osVersion] = stdout.trim().split('\n');
    return { osName, osVersion };
}

export async function getPipCacheDir(): Promise<string> {
    let stdout = '';
    try {
        const result = await execFileAsync('pip', ['cache', 'dir']);
        stdout = result.stdout;
    } catch (err: any) {
        // Mirror ignoreReturnCode: salvage stdout from a non-zero exit.
        stdout = (err.stdout ?? '').toString();
    }

    let resolvedPath = stdout.trim();
    if (resolvedPath.includes('~')) {
        resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
    }
    return resolvedPath;
}

export function getPipenvCacheDir(): string {
    const virtualEnvRelativePath = IS_WINDOWS
        ? '.virtualenvs'
        : '.local/share/virtualenvs';
    return path.join(os.homedir(), virtualEnvRelativePath);
}

interface PoetryConfig {
    'cache-dir': string;
    'virtualenvs.in-project': boolean;
    'virtualenvs.path': string;
}

async function getPoetryConfiguration(basedir: string): Promise<PoetryConfig> {
    const { stdout } = await execFileAsync('poetry', ['config', '--list'], {
        cwd: basedir
    });

    const config: any = {};
    for (let line of stdout.trim().split('\n')) {
        line = line.replace(/#.*$/gm, '');
        const [key, value] = line.split('=').map(part => part.trim());
        if (key) {
            config[key] = JSON.parse(value);
        }
    }
    return config as PoetryConfig;
}

export async function getPoetryCacheDirs(patterns: string): Promise<string[]> {
    const paths = new Set<string>();
    const globber = await glob.create(patterns);

    for await (const file of globber.globGenerator()) {
        const basedir = path.dirname(file);
        const poetryConfig = await getPoetryConfiguration(basedir);

        const cacheDir = poetryConfig['cache-dir'];
        const virtualenvsPath = poetryConfig['virtualenvs.path'].replace(
            '{cache-dir}',
            cacheDir
        );

        paths.add(virtualenvsPath);

        if (poetryConfig['virtualenvs.in-project']) {
            paths.add(path.join(basedir, '.venv'));
        }
    }

    return [...paths];
}

export async function getPythonCacheDirectories(
    packageManager: PythonPackageManager,
    dependencyPath: string
): Promise<string[]> {
    switch (packageManager) {
        case 'pip':
            return [await getPipCacheDir()];
        case 'pipenv':
            return [getPipenvCacheDir()];
        case 'poetry':
            return getPoetryCacheDirs(dependencyPath);
    }
}

export async function computePythonPrimaryKey(
    config: PythonCacheConfig
): Promise<string> {
    const { package_manager, pythonVersion } = config;
    const dependencyPath =
        config.cacheDependencyPath || DEFAULT_DEPENDENCY_PATTERNS[package_manager];

    let hash = await glob.hashFiles(dependencyPath);
    if (!hash && package_manager === 'pip') {
        hash = await glob.hashFiles(CACHE_DEPENDENCY_BACKUP_PATH);
    }

    const runnerOs = process.env['RUNNER_OS'];
    const arch = process.arch;

    if (package_manager === 'pip' && IS_LINUX) {
        const { osName, osVersion } = await getLinuxInfo();
        return `${CACHE_KEY_PREFIX}-${runnerOs}-${arch}-${osVersion}-${osName}-python-${pythonVersion}-pip-${hash}`;
    }

    if (package_manager === 'poetry') {
        // "v2" matches the upstream invalidation marker for the poetry distributor.
        return `${CACHE_KEY_PREFIX}-${runnerOs}-${arch}-python-${pythonVersion}-poetry-v2-${hash}`;
    }

    return `${CACHE_KEY_PREFIX}-${runnerOs}-${arch}-python-${pythonVersion}-${package_manager}-${hash}`;
}

export async function getPythonCache(
    config: PythonCacheConfig
): Promise<{ key: string; version: string; paths: string[] }> {
    const dependencyPath =
        config.cacheDependencyPath ||
        DEFAULT_DEPENDENCY_PATTERNS[config.package_manager];

    const key = await computePythonPrimaryKey(config);
    const paths = await getPythonCacheDirectories(
        config.package_manager,
        dependencyPath
    );

    const cacheUtils = require('@actions/cache/lib/internal/cacheUtils');
    const version = cacheUtils.getCacheVersion(paths, 'zstd-without-long');

    return { key, version, paths };
}
