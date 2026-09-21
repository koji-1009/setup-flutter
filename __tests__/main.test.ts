import {
	addPath,
	exportVariable,
	getBooleanInput,
	getInput,
	saveState,
	setFailed,
	setOutput,
	warning,
} from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPubCachePaths,
	pubCacheKey,
	restorePubCache,
	restoreSdkCache,
	sdkCacheKey,
	sdkCachePath,
} from "../src/cache";
import { installFromGit, isOriginalRepo, resolveGit } from "../src/git-source";
import { installFromArchive, setupPath } from "../src/installer";
import { run } from "../src/main";
import { registerProblemMatcher } from "../src/problem-matcher";
import { getArch, getPlatform, getPubCachePath } from "../src/utils";
import {
	fetchManifest,
	parseVersionSpec,
	resolveFromManifest,
} from "../src/version";
import { readVersionFile } from "../src/version-file";

vi.mock("@actions/core");
vi.mock("../src/utils");
vi.mock("../src/version");
vi.mock("../src/version-file");
vi.mock("../src/installer");
vi.mock("../src/cache");
vi.mock("../src/git-source");
vi.mock("../src/problem-matcher");

const defaultManifest = {
	base_url: "https://storage.googleapis.com/flutter_infra_release/releases",
	current_release: { stable: "hash1" },
	releases: [
		{
			hash: "hash1",
			channel: "stable",
			version: "3.29.3",
			dart_sdk_version: "3.7.0",
			release_date: "2025-01-15",
			archive: "stable/linux/flutter_linux_3.29.3-stable.tar.xz",
			sha256: "abc1",
		},
	],
};

const defaultResolved = {
	version: "3.29.3",
	channel: "stable",
	dartVersion: "3.7.0",
	downloadUrl:
		"https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.29.3-stable.tar.xz",
	hash: "hash1",
	sha256: "abc1",
	arch: "x64",
};

let inputs: Record<string, string>;
let boolInputs: Record<string, boolean>;

beforeEach(() => {
	inputs = {
		"flutter-version": "",
		"flutter-version-file": "",
		channel: "stable",
		architecture: "",
		"fvm-flavor": "",
		"git-source": "release",
		"git-source-url": "https://github.com/flutter/flutter.git",
	};
	boolInputs = {
		"cache-sdk": true,
		"cache-pub": true,
		"dry-run": false,
		"problem-matcher": true,
	};

	vi.mocked(getInput).mockImplementation((name: string) => inputs[name] || "");
	vi.mocked(getBooleanInput).mockImplementation(
		(name: string) => boolInputs[name] ?? false,
	);

	vi.mocked(getPlatform).mockReturnValue("linux");
	vi.mocked(getArch).mockReturnValue("x64");
	vi.mocked(getPubCachePath).mockReturnValue("/home/runner/.pub-cache");

	vi.mocked(parseVersionSpec).mockReturnValue({ type: "any" });
	vi.mocked(fetchManifest).mockResolvedValue(defaultManifest);
	vi.mocked(resolveFromManifest).mockReturnValue(defaultResolved);

	vi.mocked(installFromArchive).mockResolvedValue();

	vi.mocked(sdkCacheKey).mockReturnValue("flutter-sdk-linux-stable-3.29.3-x64");
	vi.mocked(sdkCachePath).mockReturnValue(
		"/opt/hostedtoolcache/flutter/3.29.3-stable-x64",
	);
	vi.mocked(restoreSdkCache).mockResolvedValue(false);
	vi.mocked(pubCacheKey).mockReturnValue("flutter-pub-abc123");
	vi.mocked(restorePubCache).mockResolvedValue(false);
	vi.mocked(getPubCachePaths).mockReturnValue(["/home/runner/.pub-cache"]);

	vi.mocked(isOriginalRepo).mockReturnValue(true);
	vi.mocked(resolveGit).mockResolvedValue({
		commitHash: "hash1",
		version: "3.29.3",
		ref: "3.29.3",
	});
	vi.mocked(installFromGit).mockResolvedValue();
});

describe("main run()", () => {
	it("installs latest stable with zero config", async () => {
		await run();

		expect(fetchManifest).toHaveBeenCalledWith("linux");
		expect(resolveFromManifest).toHaveBeenCalledWith(
			defaultManifest,
			{ type: "any" },
			"stable",
			"x64",
		);
		expect(installFromArchive).toHaveBeenCalledWith(
			defaultResolved,
			"/opt/hostedtoolcache/flutter/3.29.3-stable-x64",
			"linux",
		);
		expect(setupPath).toHaveBeenCalledWith(
			"/opt/hostedtoolcache/flutter/3.29.3-stable-x64",
		);
		expect(exportVariable).toHaveBeenCalledWith(
			"PUB_CACHE",
			"/home/runner/.pub-cache",
		);
		expect(addPath).toHaveBeenCalledWith("/home/runner/.pub-cache/bin");
		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.29.3");
		expect(setOutput).toHaveBeenCalledWith("dart-version", "3.7.0");
		expect(setOutput).toHaveBeenCalledWith("channel", "stable");
		expect(setOutput).toHaveBeenCalledWith("cache-sdk-hit", "false");
		expect(setOutput).toHaveBeenCalledWith("cache-pub-hit", "false");
		expect(setOutput).toHaveBeenCalledWith("architecture", "x64");
	});

	// post.ts reads these names back, so they are the contract between the two.
	it("saves the state the post step reads", async () => {
		await run();

		expect(vi.mocked(saveState).mock.calls).toEqual(
			expect.arrayContaining([
				["sdkCacheKey", "flutter-sdk-linux-stable-3.29.3-x64"],
				["sdkCachePath", "/opt/hostedtoolcache/flutter/3.29.3-stable-x64"],
				["pubCacheKey", "flutter-pub-abc123"],
				["pubCachePath", "/home/runner/.pub-cache"],
				["installSuccess", "true"],
				["sdkCacheMiss", "true"],
				["pubCacheMiss", "true"],
				["cacheSdk", "true"],
				["cachePub", "true"],
			]),
		);
	});

	it("passes the architecture input to getArch", async () => {
		inputs.architecture = "arm64";

		await run();

		expect(getArch).toHaveBeenCalledWith("arm64");
	});

	it("detects the architecture when the input is empty", async () => {
		await run();

		expect(getArch).toHaveBeenCalledWith(undefined);
	});

	it("passes fvm-flavor to readVersionFile", async () => {
		inputs["flutter-version-file"] = ".fvmrc";
		inputs["fvm-flavor"] = "staging";
		vi.mocked(readVersionFile).mockReturnValue("3.29.3");

		await run();

		expect(readVersionFile).toHaveBeenCalledWith(".fvmrc", "staging");
	});

	it("resolves exact version", async () => {
		inputs["flutter-version"] = "3.29.0";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(parseVersionSpec).toHaveBeenCalledWith("3.29.0");
		expect(resolveFromManifest).toHaveBeenCalled();
	});

	it("warns when both flutter-version and flutter-version-file are specified", async () => {
		inputs["flutter-version"] = "3.29.0";
		inputs["flutter-version-file"] = "pubspec.yaml";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Both flutter-version and flutter-version-file"),
		);
		expect(readVersionFile).not.toHaveBeenCalled();
	});

	it("overrides channel when version spec is a channel and warns", async () => {
		inputs["flutter-version-file"] = ".fvmrc";
		vi.mocked(readVersionFile).mockReturnValue("beta");
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "channel",
			channel: "beta",
		});

		await run();

		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("overriding input 'stable'"),
		);
	});

	it("does not restore cache when cache-sdk is false", async () => {
		boolInputs["cache-sdk"] = false;

		await run();

		expect(restoreSdkCache).not.toHaveBeenCalled();
	});

	it("skips pub cache when cache-pub is false", async () => {
		boolInputs["cache-pub"] = false;

		await run();

		expect(pubCacheKey).not.toHaveBeenCalled();
		expect(restorePubCache).not.toHaveBeenCalled();
	});

	it("registers the problem matcher by default", async () => {
		await run();

		expect(registerProblemMatcher).toHaveBeenCalled();
	});

	it("does not register the problem matcher when problem-matcher is false", async () => {
		boolInputs["problem-matcher"] = false;

		await run();

		expect(registerProblemMatcher).not.toHaveBeenCalled();
	});

	it("does not register the problem matcher on dry-run", async () => {
		boolInputs["dry-run"] = true;

		await run();

		expect(registerProblemMatcher).not.toHaveBeenCalled();
	});

	it("does not install when cache hit", async () => {
		vi.mocked(restoreSdkCache).mockResolvedValue(true);

		await run();

		expect(installFromArchive).not.toHaveBeenCalled();
		expect(setOutput).toHaveBeenCalledWith("cache-sdk-hit", "true");
		expect(saveState).toHaveBeenCalledWith("sdkCacheMiss", "false");
	});

	it("handles dry-run: sets outputs but does not install", async () => {
		boolInputs["dry-run"] = true;

		await run();

		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.29.3");
		expect(setOutput).toHaveBeenCalledWith("dart-version", "3.7.0");
		expect(setOutput).toHaveBeenCalledWith("channel", "stable");
		expect(setOutput).toHaveBeenCalledWith("architecture", "x64");
		expect(installFromArchive).not.toHaveBeenCalled();
		expect(restoreSdkCache).not.toHaveBeenCalled();
	});

	it("calls setFailed on error", async () => {
		vi.mocked(resolveFromManifest).mockReturnValue(null);

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining("No Flutter release found"),
		);
	});

	it("calls setFailed for an invalid git-source value", async () => {
		inputs["git-source"] = "releases";

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining("Invalid git-source"),
		);
		expect(fetchManifest).not.toHaveBeenCalled();
		expect(installFromArchive).not.toHaveBeenCalled();
	});

	// git reads a leading '-' as an option rather than a repository.
	it("calls setFailed for an option-like git-source-url", async () => {
		inputs["git-source-url"] = "--upload-pack=touch /tmp/pwn";

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining("Invalid git-source-url"),
		);
		expect(fetchManifest).not.toHaveBeenCalled();
		expect(resolveGit).not.toHaveBeenCalled();
		expect(installFromGit).not.toHaveBeenCalled();
	});

	it("uses git mode with ref spec", async () => {
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		const spec = { type: "ref" as const, ref: "my-branch" };
		vi.mocked(parseVersionSpec).mockReturnValue(spec);

		await run();

		expect(resolveGit).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			spec,
			"stable",
			expect.anything(),
		);
		expect(installFromGit).toHaveBeenCalled();
		expect(installFromArchive).not.toHaveBeenCalled();
	});

	it("uses git mode forwards the spec and channel to resolveGit", async () => {
		inputs["git-source"] = "git";
		inputs.channel = "beta";
		const spec = { type: "channel" as const, channel: "beta" };
		vi.mocked(parseVersionSpec).mockReturnValue(spec);

		await run();

		expect(resolveGit).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			spec,
			"beta",
			expect.anything(),
		);
	});

	it("uses git mode with range spec resolves a concrete version", async () => {
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		const spec = { type: "range" as const, major: 3, minor: 27 };
		vi.mocked(parseVersionSpec).mockReturnValue(spec);
		vi.mocked(resolveGit).mockResolvedValue({
			commitHash: "hash3274",
			version: "3.27.4",
			ref: "3.27.4",
		});

		await run();

		// Must resolve the range, not silently fall back to the channel HEAD.
		expect(resolveGit).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			spec,
			"stable",
			expect.anything(),
		);
		expect(installFromGit).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"3.27.4",
			expect.anything(),
			"hash3274",
		);
		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.27.4");
	});

	it("uses git mode wires the resolved version to the output", async () => {
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		const spec = { type: "constraint" as const, range: ">=3.10.0 <3.11.0" };
		vi.mocked(parseVersionSpec).mockReturnValue(spec);
		vi.mocked(resolveGit).mockResolvedValue({
			commitHash: "hash3106",
			version: "3.10.6",
			ref: "3.10.6",
		});

		await run();

		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.10.6");
	});

	it("uses git mode and fails when resolution throws", async () => {
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "constraint",
			range: ">=99.0.0",
		});
		vi.mocked(resolveGit).mockRejectedValue(
			new Error("No version tag matching ... found"),
		);

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining("No version tag matching"),
		);
		expect(installFromGit).not.toHaveBeenCalled();
	});

	it("uses git mode with cache hit skips install", async () => {
		inputs["git-source"] = "git";
		vi.mocked(parseVersionSpec).mockReturnValue({ type: "any" });
		vi.mocked(restoreSdkCache).mockResolvedValue(true);

		await run();

		expect(resolveGit).toHaveBeenCalled();
		expect(installFromGit).not.toHaveBeenCalled();
	});

	// The same commit from a fork must not share a cache entry with the original
	// repository, so the key carries a hash of the url.
	it("uses git mode keys the SDK cache by commit and repository url", async () => {
		inputs["git-source"] = "git";

		await run();

		expect(sdkCachePath).toHaveBeenCalledWith("3.29.3", "stable", "x64", {
			commitHash: "hash1",
		});
		expect(sdkCacheKey).toHaveBeenCalledWith(
			"linux",
			"stable",
			"3.29.3",
			"x64",
			{
				commitHash: "hash1",
				// sha256("https://github.com/flutter/flutter.git"), first 8 hex digits
				urlHash: "969f1d83",
			},
		);
	});

	it("reads version file when flutter-version is empty", async () => {
		inputs["flutter-version-file"] = "pubspec.yaml";
		vi.mocked(readVersionFile).mockReturnValue(">=3.29.0 <4.0.0");
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "constraint",
			range: ">=3.29.0 <4.0.0",
		});

		await run();

		expect(readVersionFile).toHaveBeenCalledWith("pubspec.yaml", undefined);
		expect(parseVersionSpec).toHaveBeenCalledWith(">=3.29.0 <4.0.0");
	});

	it("calls setFailed when fetchManifest throws", async () => {
		vi.mocked(fetchManifest).mockRejectedValue(new Error("Network error"));

		await run();

		expect(setFailed).toHaveBeenCalledWith("Network error");
	});

	it("uses git mode with fork repo (no manifest)", async () => {
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		const spec = { type: "ref" as const, ref: "my-branch" };
		vi.mocked(parseVersionSpec).mockReturnValue(spec);
		vi.mocked(isOriginalRepo).mockReturnValue(false);

		await run();

		expect(fetchManifest).not.toHaveBeenCalled();
		expect(resolveGit).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			spec,
			"stable",
			undefined,
		);
	});

	it("uses git mode and outputs the resolved ref name when no version", async () => {
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});
		vi.mocked(resolveGit).mockResolvedValue({
			commitHash: "hash1",
			version: "my-branch",
			ref: "my-branch",
		});

		await run();

		expect(setOutput).toHaveBeenCalledWith("flutter-version", "my-branch");
	});

	it("sets cache-pub-hit to true when pub cache hits", async () => {
		vi.mocked(restorePubCache).mockResolvedValue(true);

		await run();

		expect(restorePubCache).toHaveBeenCalled();
		expect(setOutput).toHaveBeenCalledWith("cache-pub-hit", "true");
	});

	it("skips pub cache restore when pubCacheKey returns null", async () => {
		vi.mocked(pubCacheKey).mockReturnValue(null);

		await run();

		expect(restorePubCache).not.toHaveBeenCalled();
	});

	it("calls setFailed with String for non-Error thrown", async () => {
		vi.mocked(fetchManifest).mockRejectedValue("string error");

		await run();

		expect(setFailed).toHaveBeenCalledWith("string error");
	});

	it("calls setFailed when readVersionFile throws", async () => {
		inputs["flutter-version-file"] = "pubspec.yaml";
		vi.mocked(readVersionFile).mockImplementation(() => {
			throw new Error("pubspec.yaml does not contain environment.flutter");
		});

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			"pubspec.yaml does not contain environment.flutter",
		);
	});
});
