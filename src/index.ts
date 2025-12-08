import { App } from './core/App';

async function main() {
    // Suppress output in production
    if (process.env.NODE_ENV === 'production') {
        process.stdout.write = (() => { }) as unknown as typeof process.stdout.write;
        process.stderr.write = (() => { }) as unknown as typeof process.stderr.write;
        console.log = () => { };
        console.error = () => { };
    }

    try {
        const app = new App();
        await app.run();
    } catch (error) {
        console.error(error);
    }
}

main().catch(error => {
    console.error(error);
});
