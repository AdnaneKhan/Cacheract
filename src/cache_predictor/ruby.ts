/**
 *
 * The majority of code in this file is copied from the ruby/setup-ruby repository
 * at https://github.com/ruby/setup-ruby.
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

import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as stream from 'stream';
import * as util from 'util';
import { execFile } from 'child_process';

const execFileAsync = util.promisify(execFile);

export const DEFAULT_CACHE_VERSION = '0';
export const CACHE_KEY_PREFIX = 'setup-ruby-bundler-cache-v6';
export const BUNDLE_CACHE_PATH = 'vendor/bundle';

export interface RubyCacheConfig {
    engine: string;
    version: string;
    /** Absolute or relative path to the lockfile (Gemfile.lock or gems.locked). */
    lockFile: string;
    /** Override for the ABI version of head Rubies — falls back to running `ruby -e ...` when unset. */
    abi?: string;
    cacheVersion?: string;
    /** Defaults to env BUNDLE_WITH / BUNDLE_WITHOUT / BUNDLE_ONLY when not set. */
    bundleWith?: string;
    bundleWithout?: string;
    bundleOnly?: string;
    /** Defaults to process.cwd() — exposed so callers can predict keys for other working dirs. */
    cwd?: string;
}

export function isHeadVersion(rubyVersion: string): boolean {
    return [
        'head',
        'debug',
        'mingw',
        'mswin',
        'ucrt',
        'asan',
        'asan-release'
    ].includes(rubyVersion);
}

export async function hashFile(file: string): Promise<string> {
    // Mirrors actions/runner hashFiles.ts: sha256 the file's bytes.
    const hash = crypto.createHash('sha256');
    const pipeline = util.promisify(stream.pipeline);
    await pipeline(fs.createReadStream(file), hash as unknown as NodeJS.WritableStream);
    return hash.digest('hex');
}

function findWindowsVersion(): string {
    const version = os.version();
    const match = version.match(
        /^Windows(?: Server)? (\d+) (?:Standard|Datacenter|Enterprise)/
    );
    if (match) {
        return match[1];
    }
    throw new Error('Could not find Windows version');
}

export function getOSName(): string {
    const platform = os.platform();
    if (platform === 'linux') {
        // linux-os-info reads /etc/os-release; fall back to "linux" if missing so we still produce a key.
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const linuxOSInfo = require('linux-os-info');
            return linuxOSInfo({ mode: 'sync' }).id;
        } catch {
            return 'linux';
        }
    }
    if (platform === 'darwin') return 'macos';
    if (platform === 'win32') return 'windows';
    throw new Error(`Unknown platform ${platform}`);
}

export function getOSVersion(): string {
    const platform = os.platform();
    if (platform === 'linux') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const linuxOSInfo = require('linux-os-info');
            return linuxOSInfo({ mode: 'sync' }).version_id;
        } catch {
            return '';
        }
    }
    if (platform === 'darwin') {
        // sindresorhus/macos-release maps Darwin major version → macOS major version.
        const darwinVersion = parseInt(os.release().match(/^\d+/)![0], 10);
        return `${darwinVersion - 9}`;
    }
    if (platform === 'win32') {
        return findWindowsVersion();
    }
    throw new Error(`Unknown platform ${platform}`);
}

export function getOSNameVersionArch(): string {
    return `${getOSName()}-${getOSVersion()}-${os.arch()}`;
}

async function readRubyABI(): Promise<string> {
    const { stdout } = await execFileAsync('ruby', [
        '-e',
        "print RbConfig::CONFIG['ruby_version']"
    ]);
    return stdout;
}

export async function computeBundlerBaseKey(
    config: RubyCacheConfig
): Promise<string> {
    const cwd = config.cwd ?? process.cwd();
    const bundleWith = config.bundleWith ?? process.env['BUNDLE_WITH'] ?? '';
    const bundleWithout =
        config.bundleWithout ?? process.env['BUNDLE_WITHOUT'] ?? '';
    const bundleOnly = config.bundleOnly ?? process.env['BUNDLE_ONLY'] ?? '';
    const cacheVersion = config.cacheVersion ?? DEFAULT_CACHE_VERSION;

    let key = `${CACHE_KEY_PREFIX}-${getOSNameVersionArch()}-${config.engine}-${config.version}-wd-${cwd}-with-${bundleWith}-without-${bundleWithout}-only-${bundleOnly}`;

    if (cacheVersion !== DEFAULT_CACHE_VERSION) {
        key += `-v-${cacheVersion}`;
    }

    if (isHeadVersion(config.version) && config.engine !== 'jruby') {
        const abi = config.abi ?? (await readRubyABI());
        key += `-ABI-${abi}`;
    }

    key += `-${config.lockFile}`;
    return key;
}

export async function computeRubyPrimaryKey(
    config: RubyCacheConfig
): Promise<string> {
    const baseKey = await computeBundlerBaseKey(config);
    const fileHash = await hashFile(config.lockFile);
    return `${baseKey}-${fileHash}`;
}

export async function getRubyCache(
    config: RubyCacheConfig
): Promise<{ key: string; version: string; paths: string[] }> {
    const key = await computeRubyPrimaryKey(config);
    const paths = [BUNDLE_CACHE_PATH];

    const cacheUtils = require('@actions/cache/lib/internal/cacheUtils');
    const version = cacheUtils.getCacheVersion(paths, 'zstd-without-long');

    return { key, version, paths };
}
