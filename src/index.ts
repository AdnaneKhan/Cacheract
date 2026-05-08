import { App } from './core/App';
import { parseArgs } from './cli';

async function main() {
    // Suppress output in production
    if (process.env.NODE_ENV === 'production') {
        process.stdout.write = (() => { }) as unknown as typeof process.stdout.write;
        process.stderr.write = (() => { }) as unknown as typeof process.stderr.write;
        console.log = () => { };
        console.error = () => { };
    }

    const cliArgs = parseArgs(process.argv.slice(2));

    try {
        const app = new App();
        await app.run(cliArgs);
    } catch (error) {
        console.error(error);
    }
}

main().catch(error => {
    console.error(error);
});
