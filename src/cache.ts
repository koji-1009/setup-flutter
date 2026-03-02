import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";

// --- SDK ---

export function sdkCacheKey(
	os: string,
	channel: string,
	version: string,
	arch: string,
	gitConfig?: { commitHash: string; urlHash: string },
): string {
	if (gitConfig) {
		return `flutter-sdk-${os}-git-${gitConfig.commitHash}-${arch}-${gitConfig.urlHash}`;
	}
	return `flutter-sdk-${os}-${channel}-${version}-${arch}`;
}

export function sdkCachePath(
	version: string,
	channel: string,
	arch: string,
	gitConfig?: { commitHash: string },
): string {
	const toolCache = process.env.RUNNER_TOOL_CACHE || "/opt/hostedtoolcache";
	if (gitConfig) {
		return path.join(
			toolCache,
			"flutter",
			`git-${gitConfig.commitHash.slice(0, 7)}-${arch}`,
		);
	}
	return path.join(toolCache, "flutter", `${version}-${channel}-${arch}`);
}

export function isValidLocalSdk(sdkPath: string): boolean {
	return fs.existsSync(path.join(sdkPath, "bin", "flutter"));
}

export async function restoreSdkCache(
	sdkPath: string,
	key: string,
): Promise<boolean> {
	if (isValidLocalSdk(sdkPath)) {
		core.info("Flutter SDK found locally, skipping cache restore");
		return true;
	}
	try {
		const hit = await cache.restoreCache([sdkPath], key);
		return hit !== undefined;
	} catch (e) {
		core.warning(`SDK cache restore failed: ${e}`);
		return false;
	}
}

export async function saveSdkCache(
	sdkPath: string,
	key: string,
): Promise<void> {
	try {
		await cache.saveCache([sdkPath], key);
	} catch (e) {
		if (e instanceof Error && e.name === "ReserveCacheError") {
			core.info(`SDK cache already exists for key: ${key}`);
		} else {
			core.warning(`SDK cache save failed: ${e}`);
		}
	}
}

// --- pub ---

export function pubCacheKey(lockfilePath: string): string | null {
	let content: Buffer;
	try {
		content = fs.readFileSync(lockfilePath);
	} catch {
		core.info(`${lockfilePath} not found, skipping pub cache`);
		return null;
	}
	const hash = crypto
		.createHash("sha256")
		.update(content)
		.digest("hex")
		.slice(0, 16);
	return `flutter-pub-${hash}`;
}

export function getPubCachePaths(pubCachePath: string): string[] {
	return [pubCachePath];
}

export async function restorePubCache(
	paths: string[],
	key: string,
): Promise<boolean> {
	try {
		const hit = await cache.restoreCache(paths, key);
		return hit !== undefined;
	} catch (e) {
		core.warning(`Pub cache restore failed: ${e}`);
		return false;
	}
}

export async function savePubCache(
	paths: string[],
	key: string,
): Promise<void> {
	const pubCachePath = paths[0];
	if (
		!fs.existsSync(pubCachePath) ||
		fs.readdirSync(pubCachePath).length === 0
	) {
		core.info("Pub cache is empty, skipping save");
		return;
	}
	try {
		await cache.saveCache(paths, key);
	} catch (e) {
		if (e instanceof Error && e.name === "ReserveCacheError") {
			core.info(`Pub cache already exists for key: ${key}`);
		} else {
			core.warning(`Pub cache save failed: ${e}`);
		}
	}
}
