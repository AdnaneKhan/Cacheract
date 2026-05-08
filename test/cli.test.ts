import { parseArgs } from '../src/cli';

describe('parseArgs', () => {
    it('returns empty object when no args supplied', () => {
        expect(parseArgs([])).toEqual({});
    });

    it('parses --runtime-token', () => {
        expect(parseArgs(['--runtime-token', 'tok123'])).toEqual({ runtimeToken: 'tok123' });
    });

    it('parses --github-token', () => {
        expect(parseArgs(['--github-token', 'gh-tok'])).toEqual({ githubToken: 'gh-tok' });
    });

    it('parses --skip-dump as a boolean flag', () => {
        expect(parseArgs(['--skip-dump'])).toEqual({ skipDump: true });
    });

    it('parses all three flags together', () => {
        const args = parseArgs([
            '--runtime-token', 'rt',
            '--github-token', 'gh',
            '--skip-dump'
        ]);
        expect(args).toEqual({ runtimeToken: 'rt', githubToken: 'gh', skipDump: true });
    });

    it('handles flags in any order', () => {
        const args = parseArgs(['--skip-dump', '--github-token', 'gh', '--runtime-token', 'rt']);
        expect(args).toEqual({ runtimeToken: 'rt', githubToken: 'gh', skipDump: true });
    });

    it('ignores unknown flags', () => {
        expect(parseArgs(['--unknown', 'val', '--runtime-token', 'rt'])).toEqual({ runtimeToken: 'rt' });
    });

    it('does not set runtimeToken when --runtime-token has no value', () => {
        expect(parseArgs(['--runtime-token'])).toEqual({});
    });

    it('does not set githubToken when --github-token has no value', () => {
        expect(parseArgs(['--github-token'])).toEqual({});
    });
});
