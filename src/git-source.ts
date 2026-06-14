import { join } from "node:path";
import { info, warning } from "@actions/core";
import { exec } from "@actions/exec";
import { prerelease, rcompare, valid } from "semver";
import {
	type FlutterManifest,
	findManifestVersion,
	specMatchesVersion,
	type VersionSpec,
} from "./version";

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

/** A resolved git target: the commit to cache, its version, and the ref to clone. */
type GitResolution = { commitHash: string; version: string; ref: string };

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

async function lsRemote(
	url: string,
	extraArgs: string[] = [],
): Promise<string[]> {
	let output = "";
	await execWithTimeout(
		"git",
		["ls-remote", ...extraArgs, url],
		LS_REMOTE_TIMEOUT_MS,
		{
			env: { ...process.env, ...GIT_TIMEOUT_ENV } as Record<string, string>,
			listeners: {
				stdout: (data: Buffer) => {
					output += data.toString();
				},
			},
		},
	);
	return output.trim().split("\n");
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
	for (const line of await lsRemote(url)) {
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

async function lsRemoteTags(url: string): Promise<Map<string, string>> {
	// `git ls-remote --tags` emits both `refs/tags/<t>` and, for annotated tags,
	// a peeled `refs/tags/<t>^{}` line (always immediately after) whose hash is
	// the commit the tag points at. Last-write-wins therefore keeps the peeled
	// commit hash, which is what we want to check out/cache.
	const byTag = new Map<string, string>();
	for (const line of await lsRemote(url, ["--tags"])) {
		if (!line) continue;
		const [hash, refPath] = line.split("\t");
		if (!refPath?.startsWith("refs/tags/")) continue;
		const tag = refPath.slice("refs/tags/".length).replace(/\^\{\}$/, "");
		byTag.set(tag, hash);
	}
	return byTag;
}

function selectBestVersionTag(
	tags: Map<string, string>,
	spec: VersionSpec,
	channel: string,
): GitResolution | null {
	// A fork carries no per-tag channel metadata, so mirror the manifest path's
	// channel scoping by stability: the stable channel excludes prereleases,
	// while beta/master allow them. Without this a `stable` + `3.x` request would
	// pick the highest matching tag overall — e.g. a `3.x.y-0.1.pre` beta.
	let best: GitResolution | null = null;
	for (const [tag, hash] of tags) {
		const version = valid(tag);
		if (!version) continue;
		if (channel === "stable" && prerelease(version) !== null) continue;
		if (!specMatchesVersion(spec, version)) continue;
		// rcompare(a, b) < 0 means version `a` is higher than `b`.
		if (!best || rcompare(version, best.version) < 0) {
			best = { commitHash: hash, version, ref: tag };
		}
	}
	return best;
}

/**
 * Resolves a range/constraint version spec to a concrete version in git mode.
 *
 * For the official repo the release manifest is preferred (authoritative and
 * arch-agnostic via `findManifestVersion`), but it only covers channels that
 * publish releases — the `master` channel has no manifest entries, and very old
 * versions fall outside its window. When the manifest yields no match (and
 * always for custom repos) the tags are enumerated with `git ls-remote --tags`
 * and the highest version satisfying the spec is chosen. Throws when nothing
 * matches anywhere, so a requested-but-unavailable version fails loudly rather
 * than silently installing the channel HEAD.
 */
export async function resolveGitVersion(
	url: string,
	spec: VersionSpec,
	channel: string,
	manifest?: FlutterManifest,
): Promise<GitResolution> {
	if (isOriginalRepo(url) && manifest) {
		const match = findManifestVersion(manifest, spec, channel);
		if (match) {
			return {
				commitHash: match.hash,
				version: match.version,
				ref: match.version,
			};
		}
	}

	info("Resolving version from git tags via ls-remote...");
	const best = selectBestVersionTag(await lsRemoteTags(url), spec, channel);
	if (!best) {
		throw new Error(
			`No version tag matching ${JSON.stringify(spec)} found in ${url}`,
		);
	}
	return best;
}

/**
 * Single entry point for git-mode resolution. Routes range/constraint specs to
 * version resolution (concrete tagged version) and channel/exact/ref/any to ref
 * resolution, returning a uniform `{commitHash, version, ref}`. Keeps the
 * spec→resolver policy in one place rather than in the caller.
 */
export async function resolveGit(
	url: string,
	spec: VersionSpec,
	channel: string,
	manifest?: FlutterManifest,
): Promise<GitResolution> {
	if (spec.type === "range" || spec.type === "constraint") {
		return resolveGitVersion(url, spec, channel, manifest);
	}

	let ref: string;
	switch (spec.type) {
		case "channel":
			ref = spec.channel;
			break;
		case "exact":
			ref = spec.version;
			break;
		case "ref":
			ref = spec.ref;
			break;
		case "any":
			ref = channel;
			break;
	}
	const result = await resolveGitRef(url, ref, manifest);
	return { commitHash: result.commitHash, version: result.version || ref, ref };
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
