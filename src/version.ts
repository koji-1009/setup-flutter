import { setTimeout as sleep } from "node:timers/promises";
import { info } from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { major, minor, satisfies, validRange } from "semver";
import { getManifestUrl, getStorageBaseUrl } from "./utils";

const MAX_FETCH_ATTEMPTS = 3;

export interface FlutterRelease {
	hash: string;
	channel: string;
	version: string;
	dart_sdk_version: string;
	dart_sdk_arch?: string;
	release_date: string;
	archive: string;
	sha256: string;
}

export interface FlutterManifest {
	base_url: string;
	current_release: Record<string, string>;
	releases: FlutterRelease[];
}

export interface ResolvedVersion {
	version: string;
	channel: string;
	dartVersion: string;
	downloadUrl: string;
	hash: string;
	sha256: string;
	arch: string;
}

export type VersionSpec =
	| { type: "exact"; version: string }
	| { type: "range"; major: number; minor?: number }
	| { type: "any" }
	| { type: "constraint"; range: string }
	| { type: "channel"; channel: string }
	| { type: "ref"; ref: string };

export function parseVersionSpec(input: string): VersionSpec {
	const trimmed = input.trim();

	if (!trimmed || trimmed === "any") {
		return { type: "any" };
	}

	if (trimmed === "stable" || trimmed === "beta" || trimmed === "master") {
		return { type: "channel", channel: trimmed };
	}

	if (/[>=<^]/.test(trimmed)) {
		if (validRange(trimmed) === null) {
			throw new Error(
				`Invalid version constraint '${trimmed}': use a semver range like '>=3.29.0 <4.0.0'`,
			);
		}
		return { type: "constraint", range: trimmed };
	}

	if (/^\d+\.x$/.test(trimmed) || /^\d+\.\d+\.x$/.test(trimmed)) {
		const parts = trimmed.split(".");
		const maj = parseInt(parts[0], 10);
		if (parts.length >= 2 && parts[1] !== "x") {
			return { type: "range", major: maj, minor: parseInt(parts[1], 10) };
		}
		return { type: "range", major: maj };
	}

	if (/^\d+\.\d+\.\d+/.test(trimmed)) {
		return { type: "exact", version: trimmed };
	}

	// Bare "3" or "3.4" is ambiguous between an exact version and a series;
	// reject it with guidance instead of guessing (or treating it as a git ref).
	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		throw new Error(
			`Ambiguous version '${trimmed}': use '${trimmed}.x' for the newest ${trimmed} release, ` +
				`a full version like '${trimmed}${trimmed.includes(".") ? "" : ".0"}.0', or a range such as '>=${trimmed}'`,
		);
	}

	return { type: "ref", ref: trimmed };
}

// getJson throws HttpClientError (with statusCode) on non-2xx responses other
// than 404; plain network errors carry no statusCode and are always retryable.
function isRetryableFetchError(error: Error): boolean {
	const status = (error as { statusCode?: unknown }).statusCode;
	if (typeof status === "number") {
		return status >= 500 || status === 408 || status === 429;
	}
	return true;
}

export async function fetchManifest(
	platform: string,
): Promise<FlutterManifest> {
	info("Fetching Flutter release manifest...");
	const url = getManifestUrl(platform);
	const http = new HttpClient("setup-flutter");

	let result: FlutterManifest | null;
	for (let attempt = 1; ; attempt++) {
		try {
			result = (await http.getJson<FlutterManifest>(url)).result;
			break;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			if (!isRetryableFetchError(err) || attempt >= MAX_FETCH_ATTEMPTS) {
				throw err;
			}
			const delaySec = Math.floor(Math.random() * 11) + 10;
			info(
				`Manifest fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed: ${err.message}. Retrying in ${delaySec}s...`,
			);
			await sleep(delaySec * 1000);
		}
	}
	if (!result) {
		// getJson maps a 404 to a null result; retrying won't help
		throw new Error(`Failed to fetch manifest from ${url}`);
	}
	const manifest = result;
	const customBaseUrl = process.env.FLUTTER_STORAGE_BASE_URL;
	if (customBaseUrl && manifest.base_url.includes("googleapis.com")) {
		manifest.base_url = manifest.base_url.replace(
			"https://storage.googleapis.com",
			getStorageBaseUrl(),
		);
	}

	return manifest;
}

/**
 * Returns whether a concrete version string satisfies a version spec.
 *
 * This is the arch-agnostic matching core shared by release-mode resolution
 * (`resolveFromManifest`) and git-mode version resolution (`findManifestVersion`
 * and tag-based resolution in git-source). `channel`/`any` always match because
 * channel filtering is the caller's responsibility.
 */
export function specMatchesVersion(
	spec: VersionSpec,
	version: string,
): boolean {
	switch (spec.type) {
		case "exact":
			return version === spec.version;
		case "range": {
			const maj = major(version);
			const min = minor(version);
			return (
				maj === spec.major && (spec.minor === undefined || min === spec.minor)
			);
		}
		case "any":
		case "channel":
			return true;
		case "constraint":
			return satisfies(version, spec.range, { includePrerelease: true });
		case "ref":
			throw new Error("ref spec cannot be used with release mode");
	}
}

/**
 * Finds the newest release on `channel` matching `spec`. Releases are ordered
 * newest-first in the manifest, so the first match is the latest. When `arch`
 * is given the release must provide an archive for it; when omitted (git mode)
 * architecture is ignored because the git tag is built for every arch.
 */
function findMatchingRelease(
	manifest: FlutterManifest,
	spec: VersionSpec,
	channel: string,
	arch?: string,
): FlutterRelease | null {
	for (const release of manifest.releases) {
		if (release.channel !== channel) continue;

		if (arch === "arm64") {
			if (release.dart_sdk_arch !== "arm64") continue;
		} else if (arch === "x64") {
			if (release.dart_sdk_arch && release.dart_sdk_arch !== "x64") continue;
		}

		if (specMatchesVersion(spec, release.version)) {
			return release;
		}
	}

	return null;
}

export function resolveFromManifest(
	manifest: FlutterManifest,
	spec: VersionSpec,
	channel: string,
	arch: string,
): ResolvedVersion | null {
	const release = findMatchingRelease(manifest, spec, channel, arch);
	if (!release) return null;
	return {
		version: release.version,
		channel: release.channel,
		dartVersion: release.dart_sdk_version,
		downloadUrl: `${manifest.base_url}/${release.archive}`,
		hash: release.hash,
		sha256: release.sha256,
		arch,
	};
}

/**
 * Resolves a version spec to a concrete release using the manifest, ignoring
 * architecture.
 *
 * Used by git mode: the release manifest is published per-OS but only lists x64
 * archives for Linux/Windows, yet the git tags exist for every architecture.
 * Resolving the version independently of arch lets git mode honor a requested
 * range/constraint on ARM64 hosts (where `resolveFromManifest` would find no
 * matching archive). Returns the newest matching release, or null if none.
 */
export function findManifestVersion(
	manifest: FlutterManifest,
	spec: VersionSpec,
	channel: string,
): { version: string; hash: string } | null {
	const release = findMatchingRelease(manifest, spec, channel);
	return release ? { version: release.version, hash: release.hash } : null;
}
