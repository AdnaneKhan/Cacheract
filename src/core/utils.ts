import * as fs from 'fs';
import { RunnerEnvironment } from './types';

export function checkRunnerEnvironment(): RunnerEnvironment {
    const runnerEnvironment = process.env.RUNNER_ENVIRONMENT;
    const runnerOS = process.env.RUNNER_OS;
    const github_hosted = runnerEnvironment === 'github-hosted';

    if (!github_hosted) {
        console.error('Cacheract is only supported on GitHub-hosted runners.');
    }

    switch (runnerOS) {
        case 'Linux':
        case 'Windows':
        case 'Darwin':
            return {
                github_hosted,
                os: runnerOS
            };
        default:
            return {
                github_hosted,
                os: 'Unknown'
            };
    }
}

export function generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function ensureDirExists(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export function cleanupFile(filePath: string, label = 'file') {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (cleanupError) {
        console.error(`Error cleaning up ${label}:`, cleanupError);
    }
}
