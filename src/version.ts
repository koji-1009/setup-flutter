import { info } from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { major, minor, satisfies } from "semver";
import { getManifestUrl } from "./utils";

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

	return { type: "ref", ref: trimmed };
}

export async function fetchManifest(
	platform: string,
): Promise<FlutterManifest> {
	info("Fetching Flutter release manifest...");
	const url = getManifestUrl(platform);
	const http = new HttpClient("setup-flutter");
	const response = await http.getJson<FlutterManifest>(url);
	if (!response.result) {
		throw new Error(`Failed to fetch manifest from ${url}`);
	}

	const manifest = response.result;
	const customBaseUrl = process.env.FLUTTER_STORAGE_BASE_URL;
	if (customBaseUrl && manifest.base_url.includes("googleapis.com")) {
		manifest.base_url = `${customBaseUrl}/flutter_infra_release`;
	}

	return manifest;
}

export function resolveFromManifest(
	manifest: FlutterManifest,
	spec: VersionSpec,
	channel: string,
	arch: string,
): ResolvedVersion | null {
	// Releases are ordered newest-first in the manifest; first match is latest.
	for (const release of manifest.releases) {
		if (release.channel !== channel) continue;

		if (arch === "arm64") {
			if (release.dart_sdk_arch !== "arm64") continue;
		} else {
			if (release.dart_sdk_arch && release.dart_sdk_arch !== "x64") continue;
		}

		let matched = false;
		switch (spec.type) {
			case "exact":
				matched = release.version === spec.version;
				break;
			case "range": {
				const maj = major(release.version);
				const min = minor(release.version);
				matched =
					maj === spec.major &&
					(spec.minor === undefined || min === spec.minor);
				break;
			}
			case "any":
			case "channel":
				matched = true;
				break;
			case "constraint":
				matched = satisfies(release.version, spec.range, {
					includePrerelease: true,
				});
				break;
			case "ref":
				throw new Error("ref spec cannot be used with release mode");
		}

		if (matched) {
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
	}

	return null;
}
