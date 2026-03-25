import { join } from "node:path";
import { info, warning } from "@actions/core";
import { exec } from "@actions/exec";
import type { FlutterManifest } from "./version";

const FLUTTER_ORIGIN = "https://github.com/flutter/flutter";

const HASH_PATTERN = /^[0-9a-f]{7,40}$/;
const FULL_HASH_PATTERN = /^[0-9a-f]{40}$/;

const GIT_TIMEOUT_MS = 10 * 60 * 1000;
const PRECACHE_TIMEOUT_MS = 10 * 60 * 1000;
const LS_REMOTE_TIMEOUT_MS = 60_000;

const GIT_TIMEOUT_ENV: Record<string, string> = {
	GIT_HTTP_LOW_SPEED_LIMIT: "1000",
	GIT_HTTP_LOW_SPEED_TIME: "60",
};

function execWithTimeout(
	cmd: string,
	args: string[],
	timeoutMs: number,
	options?: Parameters<typeof exec>[2],
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new Error(
					`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${cmd} ${args.join(" ")}`,
				),
			);
		}, timeoutMs);
		exec(cmd, args, options).then(
			(code) => {
				clearTimeout(timer);
				resolve(code);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

export function isOriginalRepo(url: string): boolean {
	const normalized = url.toLowerCase().replace(/\.git$/, "");
	return normalized === FLUTTER_ORIGIN;
}

export async function resolveGitRef(
	url: string,
	ref: string,
	manifest?: FlutterManifest,
): Promise<{ commitHash: string; version?: string }> {
	if (isOriginalRepo(url) && manifest) {
		const byVersion = manifest.releases.find((r) => r.version === ref);
		if (byVersion) {
			return { commitHash: byVersion.hash, version: byVersion.version };
		}

		if (manifest.current_release[ref]) {
			const hash = manifest.current_release[ref];
			const release = manifest.releases.find((r) => r.hash === hash);
			return { commitHash: hash, version: release?.version };
		}

		const byHash = manifest.releases.find((r) => r.hash.startsWith(ref));
		if (byHash) {
			return { commitHash: byHash.hash, version: byHash.version };
		}
	}

	info("Resolving ref via git ls-remote...");
	let output = "";
	await execWithTimeout("git", ["ls-remote", url], LS_REMOTE_TIMEOUT_MS, {
		env: { ...process.env, ...GIT_TIMEOUT_ENV } as Record<string, string>,
		listeners: {
			stdout: (data: Buffer) => {
				output += data.toString();
			},
		},
	});

	for (const line of output.trim().split("\n")) {
		const [hash, refPath] = line.split("\t");
		if (refPath === `refs/heads/${ref}` || refPath === `refs/tags/${ref}`) {
			return { commitHash: hash };
		}
	}

	if (HASH_PATTERN.test(ref)) {
		if (!FULL_HASH_PATTERN.test(ref)) {
			warning(
				`Ref '${ref}' looks like a short commit hash but could not be verified via ls-remote. ` +
					"If this is a typo, the subsequent git clone will fail.",
			);
		}
		return { commitHash: ref };
	}

	throw new Error(`Could not resolve ref '${ref}' in ${url}`);
}

export async function installFromGit(
	url: string,
	ref: string,
	sdkPath: string,
	commitHash: string,
): Promise<void> {
	const gitOpts = {
		env: { ...process.env, ...GIT_TIMEOUT_ENV } as Record<string, string>,
	};

	info(`Cloning Flutter from ${url} (ref: ${ref})...`);
	if (FULL_HASH_PATTERN.test(commitHash) && ref === commitHash) {
		// Commit hash as ref requires full clone + checkout
		await execWithTimeout(
			"git",
			["clone", url, sdkPath],
			GIT_TIMEOUT_MS,
			gitOpts,
		);
		await execWithTimeout(
			"git",
			["-C", sdkPath, "checkout", commitHash],
			GIT_TIMEOUT_MS,
			gitOpts,
		);
	} else {
		// Shallow clone with branch
		await execWithTimeout(
			"git",
			["clone", "--depth", "1", "--branch", ref, url, sdkPath],
			GIT_TIMEOUT_MS,
			gitOpts,
		);
	}

	info("Running flutter precache...");
	const flutterBin = join(sdkPath, "bin", "flutter");
	await execWithTimeout(flutterBin, ["precache"], PRECACHE_TIMEOUT_MS);
}
