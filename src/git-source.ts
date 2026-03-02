import { join } from "node:path";
import { info } from "@actions/core";
import { exec } from "@actions/exec";
import type { FlutterManifest } from "./version";

const FLUTTER_ORIGIN = "https://github.com/flutter/flutter";

const HASH_PATTERN = /^[0-9a-f]{7,40}$/;
const FULL_HASH_PATTERN = /^[0-9a-f]{40}$/;

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
	await exec("git", ["ls-remote", url], {
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
	info(`Cloning Flutter from ${url} (ref: ${ref})...`);
	if (FULL_HASH_PATTERN.test(commitHash) && ref === commitHash) {
		// Commit hash as ref requires full clone + checkout
		await exec("git", ["clone", url, sdkPath]);
		await exec("git", ["-C", sdkPath, "checkout", commitHash]);
	} else {
		// Shallow clone with branch
		await exec("git", ["clone", "--depth", "1", "--branch", ref, url, sdkPath]);
	}

	info("Running flutter precache...");
	const flutterBin = join(sdkPath, "bin", "flutter");
	await exec(flutterBin, ["precache"]);
}
