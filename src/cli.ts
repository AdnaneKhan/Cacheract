export interface CliArgs {
    runtimeToken?: string;
    githubToken?: string;
    skipDump?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--runtime-token' && argv[i + 1]) {
            args.runtimeToken = argv[++i];
        } else if (argv[i] === '--github-token' && argv[i + 1]) {
            args.githubToken = argv[++i];
        } else if (argv[i] === '--skip-dump') {
            args.skipDump = true;
        }
    }
    return args;
}
