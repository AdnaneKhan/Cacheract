

import * as path from 'path';
import * as fs from 'fs';
import os from 'os';
import * as glob from '@actions/glob';
import * as yaml from 'js-yaml';
import { getPackageManagerInfo, findLockFile, PackageManagerInfo, getCacheDirectories, NodeCacheConfig } from './cache_predictor/node';

export interface CacheParams {
    key: string;
    version: string;
}


interface SetupAction {
    name: string;
    details: any;
}


async function getNodeCache(config: NodeCacheConfig): Promise<CacheParams> {

    const platform = process.env.RUNNER_OS;
    const arch = os.arch();
    const packageManagerInfo = await getPackageManagerInfo(config.package_manager);
    if (packageManagerInfo == null) {
        throw new Error(`Unsupported package manager: ${config.package_manager}`);
    }

    const lockFilePath = config.cacheDependencyPath
        ? config.cacheDependencyPath
        : findLockFile(packageManagerInfo);
    const fileHash = await glob.hashFiles(lockFilePath);

    const keyPrefix = `node-cache-${platform}-${arch}-${config.package_manager}`;
    const primaryKey = `${keyPrefix}-${fileHash}`;

    const cachePaths = await getCacheDirectories(
        packageManagerInfo,
        config.cacheDependencyPath
    );

    const version = await calculateCacheVersion(cachePaths);

    return { key: primaryKey, version: version };
}

export function getWorkflows(): string[] {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const workflowsDir = path.join(workspace, '.github', 'workflows');

    if (!fs.existsSync(workflowsDir)) {
        return [];
    }

    const files = fs.readdirSync(workflowsDir)
        .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map(file => path.join(workflowsDir, file));
    return files;
}




export function getSetupActions(yaml: any): SetupAction[] {
    const setupActions = [
        'actions/cache',
        'actions/cache/restore',
        'actions/setup-node',
        'actions/setup-python',
        'actions/setup-go',
        'actions/setup-java'
    ];

    const matchingSteps: SetupAction[] = [];

    if (yaml.jobs) {
        for (const jobName in yaml.jobs) {
            const job = yaml.jobs[jobName];
            if (job.steps && Array.isArray(job.steps)) {
                for (const step of job.steps) {
                    if (step.uses) {
                        // Extract the action name without the version
                        const actionName = step.uses.split('@')[0];
                        if (setupActions.includes(actionName)) {
                            matchingSteps.push({
                                name: actionName,
                                details: step
                            });
                        }
                    }
                }
            }
        }
    }

    return matchingSteps;
}


export async function calculateCacheConfigs(): Promise<Set<string>> {
    // Find all .yml and .yaml files in `.github/workflows` directory.

    // Safely load yaml files and parse to get all instances of `actions/setup-node`

    let cacheParams: Set<string> = new Set();

    const workflows = getWorkflows();

    for (const workflow of workflows) {
        console.log(`Processing workflow file: ${workflow}`);
        const content = fs.readFileSync(workflow, 'utf8');

        const parsedConfig = yaml.load(content)

        const interestingActions = getSetupActions(parsedConfig)

        for (const action of interestingActions) {
            // We don't calcualte cache if cache it not defined
            //  (with exception of setup-go and actions/cache)
            let packageManager = action.details?.with?.cache;
            if (!packageManager) {
                continue;
            }

            switch (action.name) {
                case 'actions/setup-node':

                    // Handle actions/setup-node
                    console.log(`Processing ${action.name} action.`);

                    let nodeCache = {
                        package_manager: packageManager,
                        cacheDependencyPath: action.details.with.path,
                        node_version: action.details.with.node_version,
                        node_version_file: action.details.with.node_version_file
                    }

                    let cacheConfig = await getNodeCache(nodeCache);

                    cacheParams.add(`${cacheConfig.key}:${cacheConfig.version}`);
                    break;

                case 'actions/setup-python':
                    // Handle actions/setup-python
                    console.log(`Python caching not yet supported.`);
                    // let pythonCache = {

                    // }

                    // cacheConfig = await getPythonCache(pythonCache);

                    // cacheParams.add(`${cacheConfig.key}:${cacheConfig.version}`);
                    break;

                case 'actions/setup-go':
                    // Handle actions/setup-go
                    console.log(`Go caching not yet supported.`);
                    // Add your logic for actions/setup-go here
                    break;

                case 'actions/setup-java':
                    // Handle actions/setup-java
                    console.log(`Java caching.`);
                    // Add your logic for actions/setup-java here
                    break;

                default:
                    break;
            }
        }
    }
    return cacheParams;
}


export async function calculateCacheVersion(paths: string[]): Promise<string> {
    var cacheUtils = require('@actions/cache/lib/internal/cacheUtils');

    // Use same call from `actions/toolkit`.
    const version = cacheUtils.getCacheVersion(paths, 'zstd-without-long');
    return version
}
