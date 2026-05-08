import { checkRunnerEnvironment } from '../src/core/utils';
import { RunnerEnvironment } from '../src/core/types';
import { GitHubService } from '../src/services/GitHubService';

const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const originalFetch = globalThis.fetch;

describe('checkRunnerEnvironment', () => {
    const originalEnv = process.env;
    let consoleErrorMock: jest.Mock;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        consoleErrorMock = jest.fn();
        console.error = consoleErrorMock;
    });

    afterEach(() => {
        console.error = originalConsoleError;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should return GitHub-hosted and correct OS', async () => {
        process.env.RUNNER_ENVIRONMENT = 'github-hosted';
        process.env.RUNNER_OS = 'Linux';

        const env: RunnerEnvironment = checkRunnerEnvironment();

        expect(env.github_hosted).toBe(true);
        expect(env.os).toBe('Linux');
    });

    it('should handle non-GitHub-hosted runners', async () => {
        process.env.RUNNER_ENVIRONMENT = 'self-hosted';
        process.env.RUNNER_OS = 'UnknownOS';

        const env: RunnerEnvironment = checkRunnerEnvironment();

        expect(env.github_hosted).toBe(false);
        expect(env.os).toBe('Unknown');
        expect(consoleErrorMock).toHaveBeenCalledWith('Cacheract is only supported on GitHub-hosted runners.');
    });
});


describe('GitHubService', () => {
    const mockToken = 'test-auth-token';
    const mockKey = 'test-cache-key';
    const mockVersion = 'v1';
    const owner = 'test-owner';
    const repo = 'test-repo';
    const cachesUrl = `https://api.github.com/repos/${owner}/${repo}/actions/caches?key=${mockKey}`;
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/actions/caches?per_page=100`;

    const originalEnv = process.env;
    let service: GitHubService;
    let mockFetch: jest.Mock;
    let consoleErrorMock: jest.Mock;
    let consoleLogMock: jest.Mock;

    beforeEach(() => {
        process.env = { ...originalEnv, GITHUB_REPOSITORY: `${owner}/${repo}` };
        service = new GitHubService();

        mockFetch = jest.fn();
        (globalThis as any).fetch = mockFetch;

        consoleErrorMock = jest.fn();
        consoleLogMock = jest.fn();
        console.error = consoleErrorMock;
        console.log = consoleLogMock;
    });

    afterEach(() => {
        (globalThis as any).fetch = originalFetch;
        console.error = originalConsoleError;
        console.log = originalConsoleLog;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    const jsonResponse = (body: unknown, init: { status?: number; ok?: boolean } = {}) => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: 'OK',
        json: async () => body,
    } as unknown as Response);

    const emptyResponse = (status: number) => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        json: async () => ({}),
    } as unknown as Response);

    describe('clearEntry', () => {
        it('returns true and logs success when delete responds 200', async () => {
            mockFetch
                .mockResolvedValueOnce(jsonResponse({ actions_caches: [{ key: mockKey }] }))
                .mockResolvedValueOnce(emptyResponse(200));

            const result = await service.clearEntry(mockKey, mockVersion, mockToken);

            expect(mockFetch).toHaveBeenNthCalledWith(1, cachesUrl, expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({ Authorization: `Bearer ${mockToken}` }),
            }));
            expect(mockFetch).toHaveBeenNthCalledWith(2, cachesUrl, expect.objectContaining({
                method: 'DELETE',
                headers: expect.objectContaining({ Authorization: `Bearer ${mockToken}` }),
            }));
            expect(result).toBe(true);
            expect(consoleLogMock).toHaveBeenCalledWith(
                `Cache entry with key ${mockKey} and version ${mockVersion} deleted successfully.`
            );
        });

        it('returns false and logs failure when delete responds with non-success', async () => {
            mockFetch
                .mockResolvedValueOnce(jsonResponse({ actions_caches: [{ key: mockKey }] }))
                .mockResolvedValueOnce(emptyResponse(403));

            const result = await service.clearEntry(mockKey, mockVersion, mockToken);

            expect(mockFetch).toHaveBeenNthCalledWith(2, cachesUrl, expect.objectContaining({ method: 'DELETE' }));
            expect(result).toBe(false);
            expect(consoleLogMock).toHaveBeenCalledWith(
                `Error deleting key ${mockKey} and version ${mockVersion}; response was 403.`
            );
        });

        it('returns true and logs early-out when list reports no matching cache entries', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ actions_caches: [] }));

            const result = await service.clearEntry(mockKey, mockVersion, mockToken);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(cachesUrl, expect.objectContaining({ method: 'GET' }));
            expect(result).toBe(true);
            expect(consoleLogMock).toHaveBeenCalledWith(
                `Cache entry with key ${mockKey} and version ${mockVersion} does not exist.`
            );
        });

        it('returns false and logs error when fetch throws', async () => {
            const mockError = new Error('API failure');
            mockFetch.mockRejectedValue(mockError);

            const result = await service.clearEntry(mockKey, mockVersion, mockToken);

            expect(result).toBe(false);
            expect(consoleErrorMock).toHaveBeenCalledWith(`Error deleting cache entry: ${mockError}`);
        });
    });

    describe('listCacheEntries', () => {
        it('returns mapped cache entries when API call is successful', async () => {
            const apiCaches = [
                { key: 'cache-key-1', version: 'v1', ref: 'refs/heads/main', size_in_bytes: 100 },
                { key: 'cache-key-2', version: 'v2', ref: 'refs/heads/develop', size_in_bytes: 200 },
            ];
            mockFetch.mockResolvedValue(jsonResponse({ actions_caches: apiCaches }));

            const result = await service.listCacheEntries(mockToken);

            expect(mockFetch).toHaveBeenCalledWith(listUrl, expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({ Authorization: `Bearer ${mockToken}` }),
            }));
            expect(result).toEqual([
                { key: 'cache-key-1', version: 'v1', ref: 'refs/heads/main', size: 100 },
                { key: 'cache-key-2', version: 'v2', ref: 'refs/heads/develop', size: 200 },
            ]);
            expect(consoleErrorMock).not.toHaveBeenCalled();
        });

        it('logs TOKEN permission issue and returns [] on 401/403', async () => {
            mockFetch.mockResolvedValue(emptyResponse(403));

            const result = await service.listCacheEntries(mockToken);

            expect(mockFetch).toHaveBeenCalledWith(listUrl, expect.objectContaining({ method: 'GET' }));
            expect(result).toEqual([]);
            expect(consoleErrorMock).toHaveBeenCalledWith('TOKEN permission issue.');
        });

        it('logs a general error and returns [] when fetch rejects', async () => {
            const mockError = new Error('Some other API error');
            mockFetch.mockRejectedValue(mockError);

            const result = await service.listCacheEntries(mockToken);

            expect(result).toEqual([]);
            expect(consoleErrorMock).toHaveBeenCalledWith('Error listing cache entries:', mockError);
        });

        it('returns [] when actions_caches is empty', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ actions_caches: [] }));

            const result = await service.listCacheEntries(mockToken);

            expect(mockFetch).toHaveBeenCalledWith(listUrl, expect.objectContaining({ method: 'GET' }));
            expect(result).toEqual([]);
            expect(consoleErrorMock).not.toHaveBeenCalled();
        });
    });
});
