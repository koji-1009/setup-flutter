import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	addPath,
	exportVariable,
	getBooleanInput,
	getInput,
	info,
	saveState,
	setFailed,
	setOutput,
	warning,
} from "@actions/core";
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
		const flutterVersion = getInput("flutter-version");
		const flutterVersionFile = getInput("flutter-version-file");
		let channelInput = getInput("channel") || "stable";
		const archInput = getInput("architecture");
		const fvmFlavor = getInput("fvm-flavor");
		const cacheSdk = getBooleanInput("cache-sdk");
		const cachePub = getBooleanInput("cache-pub");
		const gitSource = getInput("git-source") || "release";
		const gitSourceUrl =
			getInput("git-source-url") || "https://github.com/flutter/flutter.git";
		const dryRun = getBooleanInput("dry-run");

		const platform = getPlatform();
		const arch = getArch(archInput || undefined);
		info(`Detected platform: ${platform}/${arch}`);

		let versionString = "";
		if (flutterVersion) {
			versionString = flutterVersion;
			if (flutterVersionFile) {
				warning(
					"Both flutter-version and flutter-version-file specified; using flutter-version",
				);
			}
		} else if (flutterVersionFile) {
			info(`Reading version from ${flutterVersionFile}`);
			versionString = readVersionFile(
				flutterVersionFile,
				fvmFlavor || undefined,
			);
		}

		const spec = parseVersionSpec(versionString);

		info(`Version spec: ${JSON.stringify(spec)} (channel: ${channelInput})`);

		if (spec.type === "channel") {
			if (spec.channel !== channelInput) {
				warning(
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
			info(
				`Resolved Flutter ${resolved.version} (Dart ${resolved.dartVersion}) on ${resolved.channel}/${resolved.arch}`,
			);
		} else {
			switch (spec.type) {
				case "channel":
					gitRef = spec.channel;
					break;
				case "exact":
					gitRef = spec.version;
					break;
				case "ref":
					gitRef = spec.ref;
					break;
				case "constraint":
				case "range":
				case "any":
					gitRef = channelInput;
					break;
			}
			const useManifest = isOriginalRepo(gitSourceUrl);
			const manifest = useManifest ? await fetchManifest(platform) : undefined;
			const gitResult = await resolveGitRef(gitSourceUrl, gitRef, manifest);
			gitCommitHash = gitResult.commitHash;
			info(`Resolved git ref '${gitRef}' -> ${gitCommitHash}`);
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
			setOutput("flutter-version", resolved.version);
			setOutput("dart-version", resolved.dartVersion);
			setOutput("channel", resolved.channel);
			setOutput("architecture", arch);
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
			info("Restoring SDK cache...");
			const gitCacheConfig = gitCommitHash
				? {
						commitHash: gitCommitHash,
						urlHash: createHash("sha256")
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
			saveState("sdkCacheKey", key);
			saveState("sdkCachePath", sdkDir);
		}

		if (!sdkHit) {
			if (gitSource === "release") {
				await installFromArchive(resolved, sdkDir, platform);
			} else if (gitRef && gitCommitHash) {
				await installFromGit(gitSourceUrl, gitRef, sdkDir, gitCommitHash);
			}
			info(`Flutter SDK installed to ${sdkDir}`);
		}

		info("Configuring environment...");
		setupPath(sdkDir);
		const pubCachePath = getPubCachePath();
		exportVariable("PUB_CACHE", pubCachePath);
		addPath(join(pubCachePath, "bin"));

		let pubHit = false;
		if (cachePub) {
			info("Restoring pub cache...");
			const pubKey = pubCacheKey(platform, "pubspec.lock");
			if (pubKey) {
				pubHit = await restorePubCache(getPubCachePaths(pubCachePath), pubKey);
				if (!pubHit) {
					info("Pub cache miss");
				}
				saveState("pubCacheKey", pubKey);
				saveState("pubCachePath", pubCachePath);
			}
		}

		setOutput("flutter-version", resolved.version);
		setOutput("dart-version", resolved.dartVersion);
		setOutput("channel", channelInput);
		setOutput("cache-sdk-hit", sdkHit.toString());
		setOutput("cache-pub-hit", pubHit.toString());
		setOutput("architecture", arch);

		info(
			`setup-flutter complete: Flutter ${resolved.version} (Dart ${resolved.dartVersion})`,
		);
		saveState("installSuccess", "true");
		saveState("sdkCacheMiss", (!sdkHit).toString());
		saveState("pubCacheMiss", (!pubHit).toString());
		saveState("cacheSdk", cacheSdk.toString());
		saveState("cachePub", cachePub.toString());
	} catch (error) {
		setFailed(error instanceof Error ? error.message : String(error));
	}
}

run();
