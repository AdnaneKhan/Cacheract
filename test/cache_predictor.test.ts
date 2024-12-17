import * as path from 'path';
import * as fs from 'fs';
import * as glob from '@actions/glob';
import * as exec from '@actions/exec';
import mockFs from 'mock-fs';
import { calculateCacheConfigs, calculateCacheVersion, getWorkflows, getSetupActions } from '../src/cache_predictor';
import exp from 'constants';


describe('getWorkflows', () => {
    const originalWorkspace = process.env.GITHUB_WORKSPACE;

    afterEach(() => {
        mockFs.restore();
        jest.resetModules(); // Clear the module cache
    });
    beforeAll(() => {
        // Set GITHUB_WORKSPACE to the test/resources directory
        process.env.GITHUB_WORKSPACE = path.join(__dirname, 'resources');
    });


    it('should retrieve all .yml and .yaml workflow files', () => {
        const node_path = path.join(__dirname, 'resources', 'test-node.yml');
        const content = fs.readFileSync(node_path, 'utf8');

        // Mock the file system
        mockFs({
            [path.join(__dirname, 'resources', '.github', 'workflows')]: {
                'test-node.yml': content,
                
            }
        });

        const workflows = getWorkflows();
        const expectedWorkflows = [
            path.join(__dirname, 'resources', '.github', 'workflows', 'test-node.yml'),
        ];
        expect(workflows).toEqual(expect.arrayContaining(expectedWorkflows));
        expect(workflows.length).toBe(1);
    });

    it('should return an empty array if no workflows are present', () => {
        mockFs({});

        const workflows = getWorkflows();
        
        expect(workflows).toEqual([]);
   
    });
});

describe('getSetupActions', () => {
    it('should return empty array for empty yaml', () => {
        const result = getSetupActions({});
        expect(result).toEqual([]);
    });

    it('should find setup actions in yaml', () => {
        const yaml = {
            jobs: {
                build: {
                    steps: [
                        {
                            uses: 'actions/setup-node@v2',
                            with: {
                                'node-version': '14.x',
                                'cache': 'npm'
                            }
                        }
                    ]
                }
            }
        };
        const result = getSetupActions(yaml);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            name: 'actions/setup-node',
            details: {
                uses: 'actions/setup-node@v2',
                with: {
                    'node-version': '14.x',
                    'cache': 'npm'
                }
            }
        });
    });
});

// describe('calculateCacheConfigs', () => {
//     beforeAll(() => {
//                 jest.spyOn(exec, 'getExecOutput')
//                 .mockImplementation(
//                     async (commandLine: string, args?: string[], options?: exec.ExecOptions): Promise<exec.ExecOutput> => {
//                         if (commandLine.includes('npm')) {
//                             if (options?.listeners?.stdout) {
//                                 options.listeners.stdout(Buffer.from('8.19.2'));
//                             }
//                             return {
//                                 exitCode: 0,
//                                 stdout: '8.19.2',
//                                 stderr: ''
//                             };
//                         }
//                         return {
//                             exitCode: 1,
//                             stdout: '',
//                             stderr: 'Command not found'
//                         };
//                     }
//                 );
//             });
//     beforeEach(() => {
//         const node_path = path.join(__dirname, 'resources', 'test-node.yml');
//         const content = fs.readFileSync(node_path, 'utf8');

//         // Mock the file system
//         mockFs({
//             [path.join(__dirname, 'resources')]: {
//                 '.github': {
//                     'workflows': {
//                         'test-node.yml': content
//                     }
//                 },
//                 'package-lock.json': JSON.stringify({
//                     name: "test-project",
//                     version: "1.0.0",
//                     lockfileVersion: 2,
//                     requires: true,
//                     packages: {}
//                 })
//             }
//         });
//     });

//     afterEach(() => {
//         mockFs.restore();
//     });

//     it('should process workflow files', async () => {
//         const configs = await calculateCacheConfigs();
//         expect(configs).toBeDefined();
//     });
//     it('should pick up a cache entry', async () => {
//         const configs = await calculateCacheConfigs();
//         expect(configs).toBeDefined();
//         expect(configs).toHaveLength(1);
//     });
// });

describe('calculateCacheVersion', () => {

    it('should return version string for empty paths', async () => {

        const version = await calculateCacheVersion([]);
        expect(typeof version).toBe('string');
    });

    it('should return version string for valid paths', async () => {
        const version = await calculateCacheVersion(['package-lock.json']);
        console.log(version);
        expect(typeof version).toBe('string');
    });
})