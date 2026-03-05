import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { restoreCache, saveCache } from "@actions/cache";
import { info, warning } from "@actions/core";

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
		return join(
			toolCache,
			"flutter",
			`git-${gitConfig.commitHash.slice(0, 7)}-${arch}`,
		);
	}
	return join(toolCache, "flutter", `${version}-${channel}-${arch}`);
}

export function isValidLocalSdk(sdkPath: string): boolean {
	return existsSync(join(sdkPath, "bin", "flutter"));
}

export async function restoreSdkCache(
	sdkPath: string,
	key: string,
): Promise<boolean> {
	if (isValidLocalSdk(sdkPath)) {
		info("Flutter SDK found locally, skipping cache restore");
		return true;
	}
	try {
		const hit = await restoreCache([sdkPath], key);
		if (hit !== undefined) {
			info("SDK cache hit");
		}
		return hit !== undefined;
	} catch (e) {
		warning(`SDK cache restore failed: ${e}`);
		return false;
	}
}

export async function saveSdkCache(
	sdkPath: string,
	key: string,
): Promise<void> {
	try {
		await saveCache([sdkPath], key);
	} catch (e) {
		if (e instanceof Error && e.name === "ReserveCacheError") {
			info(`SDK cache already exists for key: ${key}`);
		} else {
			warning(`SDK cache save failed: ${e}`);
		}
	}
}

// --- pub ---

export function pubCacheKey(os: string, lockfilePath: string): string | null {
	let content: Buffer;
	try {
		content = readFileSync(lockfilePath);
	} catch {
		info(`${lockfilePath} not found, skipping pub cache`);
		return null;
	}
	const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
	return `flutter-pub-${os}-${hash}`;
}

export function getPubCachePaths(pubCachePath: string): string[] {
	return [pubCachePath];
}

export async function restorePubCache(
	paths: string[],
	key: string,
): Promise<boolean> {
	try {
		const hit = await restoreCache(paths, key);
		if (hit !== undefined) {
			info("Pub cache hit");
		}
		return hit !== undefined;
	} catch (e) {
		warning(`Pub cache restore failed: ${e}`);
		return false;
	}
}

export async function savePubCache(
	paths: string[],
	key: string,
): Promise<void> {
	const pubCachePath = paths[0];
	if (!existsSync(pubCachePath) || readdirSync(pubCachePath).length === 0) {
		info("Pub cache is empty, skipping save");
		return;
	}
	try {
		await saveCache(paths, key);
	} catch (e) {
		if (e instanceof Error && e.name === "ReserveCacheError") {
			info(`Pub cache already exists for key: ${key}`);
		} else {
			warning(`Pub cache save failed: ${e}`);
		}
	}
}
