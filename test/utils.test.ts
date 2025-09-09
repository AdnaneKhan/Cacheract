import { checkRunnerEnvironment, RunnerEnvironment, clearEntry, listCacheEntries } from '../src/utils';
import * as github from '@actions/github';
import { mocked } from 'jest-mock';


jest.mock('@actions/github', () => ({
    getOctokit: jest.fn(),
    context: {
        repo: {
            owner: 'default-owner',
            repo: 'default-repo'
        }
    }
}));

const mockedGetOctokit = mocked(github.getOctokit);

describe('checkRunnerEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should return GitHub-hosted and correct OS', async () => {
        process.env.RUNNER_ENVIRONMENT = 'github-hosted';
        process.env.RUNNER_OS = 'Linux';

        const env: RunnerEnvironment = await checkRunnerEnvironment();

        expect(env.github_hosted).toBe(true);
        expect(env.os).toBe('Linux');
    });

    it('should handle non-GitHub-hosted runners', async () => {
        console.error = jest.fn();
        process.env.RUNNER_ENVIRONMENT = 'self-hosted';
        process.env.RUNNER_OS = 'UnknownOS';

        const env: RunnerEnvironment = await checkRunnerEnvironment();

        expect(env.github_hosted).toBe(false);
        expect(env.os).toBe('Unknown');
        expect(console.error).toHaveBeenCalledWith('Cacheract is only supported on GitHub-hosted runners.');
    });
});


describe('clearEntry', () => {
    const mockAuthToken = 'test-auth-token';
    const mockKey = 'test-cache-key';
    const mockVersion = 'v1';
    const owner = 'test-owner';
    const repo = 'test-repo';

    let mockRequest: jest.Mock;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.resetAllMocks();

        // Set up the mock for octokit.request
        mockRequest = jest.fn();
        const mockOctokit = {
            request: mockRequest,
        };
        mockedGetOctokit.mockReturnValue(mockOctokit as any);

        // Mock the GitHub context.repo property using Object.defineProperty
        Object.defineProperty(github.context, 'repo', {
            value: { owner, repo },
            writable: true, // Allows the property to be overwritten
        });
    });

    it('should return true and log success when deletion is successful (status 200)', async () => {
        // Arrange
        mockRequest.mockResolvedValueOnce({ status: 200, data: { actions_caches: { length: 1 } } } ) // First API call
            .mockResolvedValueOnce({ status: 200}); // Second API call


        // Spy on console.log
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        const result = await clearEntry(mockKey, mockVersion, mockAuthToken);

        // Assertions
        expect(github.getOctokit).toHaveBeenCalledWith(mockAuthToken);
        expect(mockRequest).toHaveBeenNthCalledWith(1, 'GET /repos/{owner}/{repo}/actions/caches?key={key}', {
            owner: owner,
            repo: repo,
            key: mockKey,
        });
        expect(mockRequest).toHaveBeenNthCalledWith(2, 'DELETE /repos/{owner}/{repo}/actions/caches?key={key}', {
            owner: owner,
            repo: repo,
            key: mockKey,
        });
        expect(result).toBe(true);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Cache entry with key ${mockKey} and version ${mockVersion} deleted successfully.`
        );

        // Restore the original implementation
        consoleLogSpy.mockRestore();
    });

    it('should return false and log failure when deletion response is not status 200', async () => {
        // Arrange
        mockRequest.mockResolvedValueOnce({ status: 200, data: { actions_caches: { length: 1 } } } )
                   .mockResolvedValue({ status: 403 });

        // Spy on console.log
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        // Act
        const result = await clearEntry(mockKey, mockVersion, mockAuthToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockAuthToken);
        expect(mockRequest).toHaveBeenNthCalledWith(1, 'GET /repos/{owner}/{repo}/actions/caches?key={key}', {
            owner: owner,
            repo: repo,
            key: mockKey,
        });
        expect(mockRequest).toHaveBeenNthCalledWith(2, 'DELETE /repos/{owner}/{repo}/actions/caches?key={key}', {
            owner: owner,
            repo: repo,
            key: mockKey,
        });
        expect(result).toBe(false);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Error deleting key ${mockKey} and version ${mockVersion} as deleted since response was 403.`
        );

        // Restore the original implementation
        consoleLogSpy.mockRestore();
    });

    it('should return true and log success when cache does not exist (status 404)', async () => {
        // Arrange
        mockRequest.mockResolvedValue({ status: 404 });

        // Spy on console.log
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        // Act
        const result = await clearEntry(mockKey, mockVersion, mockAuthToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockAuthToken);
        expect(mockRequest).toHaveBeenCalledWith(
            'DELETE /repos/{owner}/{repo}/actions/caches?key={key}',
            {
                owner,
                repo,
                key: mockKey,
            }
        );
        expect(result).toBe(true);
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `Treating key ${mockKey} and version ${mockVersion} as deleted since response was 404.`
        );

        // Restore the original implementation
        consoleLogSpy.mockRestore();
    });

    it('should return false and log error when API request throws an error', async () => {
        // Arrange
        const mockError = new Error('API failure');
        mockRequest.mockRejectedValue(mockError);

        // Spy on console.error
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        // Act
        const result = await clearEntry(mockKey, mockVersion, mockAuthToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockAuthToken);
        expect(mockRequest).toHaveBeenNthCalledWith(1, 'GET /repos/{owner}/{repo}/actions/caches?key={key}', {
            owner: owner,
            repo: repo,
            key: mockKey,
        });
        expect(result).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            `Error deleting cache entry: ${mockError}`
        );

        // Restore the original implementation
        consoleErrorSpy.mockRestore();
    });
});


describe('listCacheEntries', () => {
    const mockToken = 'test-token';
    const owner = 'test-owner';
    const repo = 'test-repo';

    let mockRequest: jest.Mock;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.resetAllMocks();

        // Set up the mock for octokit.request
        mockRequest = jest.fn();
        const mockOctokit = {
            request: mockRequest,
        };
        mockedGetOctokit.mockReturnValue(mockOctokit as any);

    });

    it('should return a list of cache entries when API call is successful', async () => {
        // Arrange
        const mockCaches = [
            { key: 'cache-key-1', version: 'v1', ref: 'refs/heads/main' },
            { key: 'cache-key-2', version: 'v2', ref: 'refs/heads/develop' },
        ];
        mockRequest.mockResolvedValue({
            data: {
                actions_caches: mockCaches,
            },
        });

        // Spy on console.error
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        // Act
        const result = await listCacheEntries(mockToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockToken);
        expect(mockRequest).toHaveBeenCalledWith(
            'GET /repos/{owner}/{repo}/actions/caches',
            {
                owner,
                repo,
                per_page: 100
            }
        );
        expect(result).toEqual([
            { key: 'cache-key-1', version: 'v1', ref: 'refs/heads/main' },
            { key: 'cache-key-2', version: 'v2', ref: 'refs/heads/develop' },
        ]);
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        // Restore the original implementation
        consoleErrorSpy.mockRestore();
    });

    it('should log TOKEN permission issue and return empty array when specific error occurs', async () => {
        // Arrange
        const mockError = new Error('Resource not accessible by integration');
        mockRequest.mockRejectedValue(mockError);

        // Spy on console.error
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        // Act
        const result = await listCacheEntries(mockToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockToken);
        expect(mockRequest).toHaveBeenCalledWith(
            'GET /repos/{owner}/{repo}/actions/caches',
            {
                owner,
                repo,
                per_page: 100
            }
        );
        expect(result).toEqual([]);
        expect(consoleErrorSpy).toHaveBeenCalledWith('TOKEN permission issue.');

        // Restore the original implementation
        consoleErrorSpy.mockRestore();
    });

    it('should log general error and return empty array when API request throws an error', async () => {
        // Arrange
        const mockError = new Error('Some other API error');
        mockRequest.mockRejectedValue(mockError);

        // Spy on console.error
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        // Act
        const result = await listCacheEntries(mockToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockToken);
        expect(mockRequest).toHaveBeenCalledWith(
            'GET /repos/{owner}/{repo}/actions/caches',
            {
                owner,
                repo,
                per_page: 100
            }
        );
        expect(result).toEqual([]);
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error listing cache entries:', mockError);

        // Restore the original implementation
        consoleErrorSpy.mockRestore();
    });

    it('should return an empty array when there are no cache entries', async () => {
        // Arrange
        mockRequest.mockResolvedValue({
            data: {
                actions_caches: [],
            },
        });

        // Spy on console.error
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        // Act
        const result = await listCacheEntries(mockToken);

        // Assert
        expect(github.getOctokit).toHaveBeenCalledWith(mockToken);
        expect(mockRequest).toHaveBeenCalledWith(
            'GET /repos/{owner}/{repo}/actions/caches',
            {
                owner,
                repo,
                per_page: 100
            }
        );
        expect(result).toEqual([]);
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        // Restore the original implementation
        consoleErrorSpy.mockRestore();
    });
});