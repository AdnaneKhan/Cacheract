/**
 * 
 * The majority of code in this file is copied from the actions/setup-node repository
 * at https://github.com/actions/setup-node.
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
import * as exec from '@actions/exec';
import path from 'path';
import fs from 'fs';

export interface PackageManagerInfo {
    name: string;
    lockFilePatterns: Array<string>;
    getCacheFolderPath: (projectDir?: string) => Promise<string>;
}


export interface PackageManagerInfo {
    name: string;
    lockFilePatterns: Array<string>;
    getCacheFolderPath: (projectDir?: string) => Promise<string>;
}

export interface NodeCacheConfig {
    package_manager: string;
    cacheDependencyPath: string;
    node_version?: string;
    node_version_file?: string;
}

interface SupportedPackageManagers {
    npm: PackageManagerInfo;
    pnpm: PackageManagerInfo;
    yarn: PackageManagerInfo;
}

export const findLockFile = (packageManager: PackageManagerInfo) => {
    const lockFiles = packageManager.lockFilePatterns;
    const workspace = process.env.GITHUB_WORKSPACE!;

    const rootContent = fs.readdirSync(workspace);

    const lockFile = lockFiles.find(item => rootContent.includes(item));
    if (!lockFile) {
        throw new Error(
            `Dependencies lock file is not found in ${workspace}. Supported file patterns: ${lockFiles.toString()}`
        );
    }

    return path.join(workspace, lockFile);
};

export const getCommandOutput = async (
    toolCommand: string,
    cwd?: string
): Promise<string> => {
    let { stdout, stderr, exitCode } = await exec.getExecOutput(
        toolCommand,
        undefined,
        { ignoreReturnCode: true, ...(cwd && { cwd }) }
    );

    if (exitCode) {
        stderr = !stderr.trim()
            ? `The '${toolCommand}' command failed with exit code: ${exitCode}`
            : stderr;
        throw new Error(stderr);
    }

    return stdout.trim();
};

export const getCommandOutputNotEmpty = async (
    toolCommand: string,
    error: string,
    cwd?: string
): Promise<string> => {
    const stdOut = getCommandOutput(toolCommand, cwd);
    if (!stdOut) {
        throw new Error(error);
    }
    return stdOut;
};

export const supportedPackageManagers: SupportedPackageManagers = {
    npm: {
        name: 'npm',
        lockFilePatterns: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'],
        getCacheFolderPath: () =>
            getCommandOutputNotEmpty(
                'npm config get cache',
                'Could not get npm cache folder path'
            )
    },
    pnpm: {
        name: 'pnpm',
        lockFilePatterns: ['pnpm-lock.yaml'],
        getCacheFolderPath: () =>
            getCommandOutputNotEmpty(
                'pnpm store path --silent',
                'Could not get pnpm cache folder path'
            )
    },
    yarn: {
        name: 'yarn',
        lockFilePatterns: ['yarn.lock'],
        getCacheFolderPath: async projectDir => {
            const yarnVersion = await getCommandOutputNotEmpty(
                `yarn --version`,
                'Could not retrieve version of yarn',
                projectDir
            );

            console.log(
                `Consumed yarn version is ${yarnVersion} (working dir: "${projectDir || ''
                }")`
            );

            const stdOut = yarnVersion.startsWith('1.')
                ? await getCommandOutput('yarn cache dir', projectDir)
                : await getCommandOutput('yarn config get cacheFolder', projectDir);

            if (!stdOut) {
                throw new Error(
                    `Could not get yarn cache folder path for ${projectDir}`
                );
            }
            return stdOut;
        }
    }
};

export const unique = () => {
    const encountered = new Set();
    return (value: unknown): boolean => {
        if (encountered.has(value)) return false;
        encountered.add(value);
        return true;
    };
};

/**
 * getProjectDirectoriesFromCacheDependencyPath is called twice during `restoreCache`
 *  - first through `getCacheDirectories`
 *  - second from `repoHasYarn3ManagedCache`
 *
 *  it contains expensive IO operation and thus should be memoized
 */

let projectDirectoriesMemoized: string[] | null = null;

/**
 * Finds the cache directories configured for the repo ignoring cache-dependency-path
 * @param packageManagerInfo - an object having getCacheFolderPath method specific to given PM
 * @return list of files on which the cache depends
 */
const getCacheDirectoriesForRootProject = async (
    packageManagerInfo: PackageManagerInfo
): Promise<string[]> => {
    const cacheFolderPath = await packageManagerInfo.getCacheFolderPath();
    console.log(
        `${packageManagerInfo.name}'s cache folder "${cacheFolderPath}" configured for the root directory`
    );
    return [cacheFolderPath];
};

/**
 * Expands (converts) the string input `cache-dependency-path` to list of directories that
 * may be project roots
 * @param cacheDependencyPath - either a single string or multiline string with possible glob patterns
 *                              expected to be the result of `core.getInput('cache-dependency-path')`
 * @return list of directories and possible
 */
const getProjectDirectoriesFromCacheDependencyPath = async (
    cacheDependencyPath: string
): Promise<string[]> => {
    if (projectDirectoriesMemoized !== null) {
        return projectDirectoriesMemoized;
    }

    const globber = await glob.create(cacheDependencyPath);
    const cacheDependenciesPaths = await globber.glob();

    const existingDirectories: string[] = cacheDependenciesPaths
        .map(path.dirname)
        .filter(unique())
        .map(dirName => fs.realpathSync(dirName))
        .filter(directory => fs.lstatSync(directory).isDirectory());

    if (!existingDirectories.length)
        console.log(
            `No existing directories found containing cache-dependency-path="${cacheDependencyPath}"`
        );

    projectDirectoriesMemoized = existingDirectories;
    return existingDirectories;
};

export const getPackageManagerInfo = async (packageManager: string) => {
    if (packageManager === 'npm') {
        return supportedPackageManagers.npm;
    } else if (packageManager === 'pnpm') {
        return supportedPackageManagers.pnpm;
    } else if (packageManager === 'yarn') {
        return supportedPackageManagers.yarn;
    } else {
        return null;
    }
};

/**
 *
 * 
 * A function to find the cache directories configured for the repo
 * currently it handles only the case of PM=yarn && cacheDependencyPath is not empty
 * @param packageManagerInfo - an object having getCacheFolderPath method specific to given PM
 * @param cacheDependencyPath - either a single string or multiline string with possible glob patterns
 *                              expected to be the result of `core.getInput('cache-dependency-path')`
 * @return list of files on which the cache depends
 */
export const getCacheDirectories = async (
    packageManagerInfo: PackageManagerInfo,
    cacheDependencyPath: string
): Promise<string[]> => {
    // For yarn, if cacheDependencyPath is set, ask information about cache folders in each project
    // folder satisfied by cacheDependencyPath https://github.com/actions/setup-node/issues/488
    if (packageManagerInfo.name === 'yarn' && cacheDependencyPath) {
        return getCacheDirectoriesFromCacheDependencyPath(
            packageManagerInfo,
            cacheDependencyPath
        );
    }
    return getCacheDirectoriesForRootProject(packageManagerInfo);
};

/**
 * Finds the cache directories configured for the repo if cache-dependency-path is not empty
 * @param packageManagerInfo - an object having getCacheFolderPath method specific to given PM
 * @param cacheDependencyPath - either a single string or multiline string with possible glob patterns
 *                              expected to be the result of `core.getInput('cache-dependency-path')`
 * @return list of files on which the cache depends
 */
const getCacheDirectoriesFromCacheDependencyPath = async (
    packageManagerInfo: PackageManagerInfo,
    cacheDependencyPath: string
): Promise<string[]> => {
    const projectDirectories = await getProjectDirectoriesFromCacheDependencyPath(
        cacheDependencyPath
    );
    const cacheFoldersPaths = await Promise.all(
        projectDirectories.map(async projectDirectory => {
            const cacheFolderPath = await packageManagerInfo.getCacheFolderPath(
                projectDirectory
            );
            console.log(
                `${packageManagerInfo.name}'s cache folder "${cacheFolderPath}" configured for the directory "${projectDirectory}"`
            );
            return cacheFolderPath;
        })
    );
    // uniq in order to do not cache the same directories twice
    return cacheFoldersPaths.filter(unique());
};