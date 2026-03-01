import * as crypto from "node:crypto";
import * as core from "@actions/core";
import {
	getPubCachePaths,
	pubCacheKey,
	restorePubCache,
	restoreSdkCache,
	sdkCacheKey,
	sdkCachePath,
} from "./cache";
import { installFromGit, isOriginalRepo, resolveGitRef } from "./git-source";
import { installFromArchive, setupPath } from "./installer";
import { getArch, getPlatform, getPubCachePath } from "./utils";
import {
	fetchManifest,
	parseVersionSpec,
	type ResolvedVersion,
	resolveFromManifest,
} from "./version";
import { readVersionFile } from "./version-file";

export async function run(): Promise<void> {
	try {
		const flutterVersion = core.getInput("flutter-version");
		const flutterVersionFile = core.getInput("flutter-version-file");
		let channelInput = core.getInput("channel") || "stable";
		const archInput = core.getInput("architecture");
		const fvmFlavor = core.getInput("fvm-flavor");
		const cacheSdk = core.getBooleanInput("cache-sdk");
		const cachePub = core.getBooleanInput("cache-pub");
		const gitSource = core.getInput("git-source") || "release";
		const gitSourceUrl =
			core.getInput("git-source-url") ||
			"https://github.com/flutter/flutter.git";
		const dryRun = core.getBooleanInput("dry-run");

		const platform = getPlatform();
		const arch = getArch(archInput || undefined);

		let versionString = "";
		if (flutterVersion) {
			versionString = flutterVersion;
			if (flutterVersionFile) {
				core.warning(
					"Both flutter-version and flutter-version-file specified; using flutter-version",
				);
			}
		} else if (flutterVersionFile) {
			versionString = await readVersionFile(
				flutterVersionFile,
				fvmFlavor || undefined,
			);
		}

		const spec = parseVersionSpec(versionString);

		if (spec.type === "channel") {
			if (spec.channel !== channelInput) {
				core.warning(
					`Version specifies channel '${spec.channel}', overriding input '${channelInput}'`,
				);
			}
			channelInput = spec.channel;
		}

		let resolved: ResolvedVersion | undefined;
		let gitCommitHash: string | undefined;
		let gitRef: string | undefined;

		if (gitSource === "release") {
			const manifest = await fetchManifest(platform);
			const result = resolveFromManifest(manifest, spec, channelInput, arch);
			if (!result) {
				throw new Error(
					`No Flutter release found matching ${JSON.stringify(spec)} on ${channelInput}/${arch}`,
				);
			}
			resolved = result;
		} else {
			gitRef =
				spec.type === "any"
					? channelInput
					: spec.type === "channel"
						? spec.channel
						: spec.type === "exact"
							? spec.version
							: spec.type === "ref"
								? spec.ref
								: channelInput;
			const useManifest = isOriginalRepo(gitSourceUrl);
			const manifest = useManifest ? await fetchManifest(platform) : undefined;
			const gitResult = await resolveGitRef(gitSourceUrl, gitRef, manifest);
			gitCommitHash = gitResult.commitHash;
			resolved = {
				version: gitResult.version || gitRef,
				channel: channelInput,
				dartVersion: "unknown",
				downloadUrl: "",
				hash: gitCommitHash,
				sha256: "",
				arch,
			};
		}

		if (dryRun) {
			core.setOutput("flutter-version", resolved.version);
			core.setOutput("dart-version", resolved.dartVersion);
			core.setOutput("channel", resolved.channel);
			core.setOutput("architecture", arch);
			return;
		}

		const sdkDir = sdkCachePath(
			resolved.version,
			channelInput,
			arch,
			gitCommitHash ? { commitHash: gitCommitHash } : undefined,
		);

		let sdkHit = false;
		if (cacheSdk) {
			const gitCacheConfig = gitCommitHash
				? {
						commitHash: gitCommitHash,
						urlHash: crypto
							.createHash("sha256")
							.update(gitSourceUrl)
							.digest("hex")
							.slice(0, 8),
					}
				: undefined;
			const key = sdkCacheKey(
				platform,
				channelInput,
				resolved.version,
				arch,
				gitCacheConfig,
			);
			sdkHit = await restoreSdkCache(sdkDir, key);
			core.saveState("sdkCacheKey", key);
			core.saveState("sdkCachePath", sdkDir);
		}

		if (!sdkHit) {
			if (gitSource === "release") {
				await installFromArchive(resolved, sdkDir, platform);
			} else {
				await installFromGit(
					gitSourceUrl,
					gitRef as string,
					sdkDir,
					gitCommitHash as string,
				);
			}
		}

		setupPath(sdkDir);
		const pubCachePath = getPubCachePath();
		core.exportVariable("PUB_CACHE", pubCachePath);

		let pubHit = false;
		if (cachePub) {
			const pubKey = pubCacheKey("pubspec.lock");
			if (pubKey) {
				pubHit = await restorePubCache(getPubCachePaths(pubCachePath), pubKey);
				core.saveState("pubCacheKey", pubKey);
				core.saveState("pubCachePath", pubCachePath);
			}
		}

		core.setOutput("flutter-version", resolved.version);
		core.setOutput("dart-version", resolved.dartVersion);
		core.setOutput("channel", channelInput);
		core.setOutput("cache-sdk-hit", sdkHit.toString());
		core.setOutput("cache-pub-hit", pubHit.toString());
		core.setOutput("architecture", arch);

		core.saveState("installSuccess", "true");
		core.saveState("sdkCacheMiss", (!sdkHit).toString());
		core.saveState("pubCacheMiss", (!pubHit).toString());
		core.saveState("cacheSdk", cacheSdk.toString());
		core.saveState("cachePub", cachePub.toString());
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	}
}

run();
