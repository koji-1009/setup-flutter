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
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPubCachePaths,
	pubCacheKey,
	restorePubCache,
	restoreSdkCache,
	sdkCacheKey,
	sdkCachePath,
} from "../src/cache";
import {
	installFromGit,
	isOriginalRepo,
	resolveGitRef,
} from "../src/git-source";
import { installFromArchive, setupPath } from "../src/installer";
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

const { run } = await import("../src/main");

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

function setupDefaultMocks() {
	const inputs: Record<string, string> = {
		"flutter-version": "",
		"flutter-version-file": "",
		channel: "stable",
		architecture: "",
		"fvm-flavor": "",
		"git-source": "release",
		"git-source-url": "https://github.com/flutter/flutter.git",
	};
	const boolInputs: Record<string, boolean> = {
		"cache-sdk": true,
		"cache-pub": true,
		"dry-run": false,
	};

	vi.mocked(getInput).mockImplementation((name: string) => inputs[name] || "");
	vi.mocked(getBooleanInput).mockImplementation(
		(name: string) => boolInputs[name] ?? false,
	);
	vi.mocked(setOutput).mockImplementation(() => {});
	vi.mocked(saveState).mockImplementation(() => {});
	vi.mocked(setFailed).mockImplementation(() => {});
	vi.mocked(warning).mockImplementation(() => {});
	vi.mocked(info).mockImplementation(() => {});
	vi.mocked(exportVariable).mockImplementation(() => {});
	vi.mocked(addPath).mockImplementation(() => {});

	vi.mocked(getPlatform).mockReturnValue("linux");
	vi.mocked(getArch).mockReturnValue("x64");
	vi.mocked(getPubCachePath).mockReturnValue("/home/runner/.pub-cache");

	vi.mocked(parseVersionSpec).mockReturnValue({ type: "any" });
	vi.mocked(fetchManifest).mockResolvedValue(defaultManifest);
	vi.mocked(resolveFromManifest).mockReturnValue(defaultResolved);

	vi.mocked(installFromArchive).mockResolvedValue();
	vi.mocked(setupPath).mockImplementation(() => {});

	vi.mocked(sdkCacheKey).mockReturnValue("flutter-sdk-linux-stable-3.29.3-x64");
	vi.mocked(sdkCachePath).mockReturnValue(
		"/opt/hostedtoolcache/flutter/3.29.3-stable-x64",
	);
	vi.mocked(restoreSdkCache).mockResolvedValue(false);
	vi.mocked(pubCacheKey).mockReturnValue("flutter-pub-abc123");
	vi.mocked(restorePubCache).mockResolvedValue(false);
	vi.mocked(getPubCachePaths).mockReturnValue(["/home/runner/.pub-cache"]);

	vi.mocked(isOriginalRepo).mockReturnValue(true);
	vi.mocked(resolveGitRef).mockResolvedValue({
		commitHash: "hash1",
		version: "3.29.3",
	});
	vi.mocked(installFromGit).mockResolvedValue();

	return { inputs, boolInputs };
}

describe("main run()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("installs latest stable with zero config", async () => {
		setupDefaultMocks();
		await run();

		expect(fetchManifest).toHaveBeenCalledWith("linux");
		expect(resolveFromManifest).toHaveBeenCalled();
		expect(installFromArchive).toHaveBeenCalled();
		expect(setupPath).toHaveBeenCalled();
		expect(addPath).toHaveBeenCalledWith("/home/runner/.pub-cache/bin");
		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.29.3");
		expect(saveState).toHaveBeenCalledWith("installSuccess", "true");
	});

	it("resolves exact version", async () => {
		const { inputs } = setupDefaultMocks();
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
		const { inputs } = setupDefaultMocks();
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
		const { inputs } = setupDefaultMocks();
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
		const { boolInputs } = setupDefaultMocks();
		boolInputs["cache-sdk"] = false;

		await run();

		expect(restoreSdkCache).not.toHaveBeenCalled();
	});

	it("skips pub cache when cache-pub is false", async () => {
		const { boolInputs } = setupDefaultMocks();
		boolInputs["cache-pub"] = false;

		await run();

		expect(pubCacheKey).not.toHaveBeenCalled();
		expect(restorePubCache).not.toHaveBeenCalled();
	});

	it("does not install when cache hit", async () => {
		setupDefaultMocks();
		vi.mocked(restoreSdkCache).mockResolvedValue(true);

		await run();

		expect(installFromArchive).not.toHaveBeenCalled();
	});

	it("handles dry-run: sets outputs but does not install", async () => {
		const { boolInputs } = setupDefaultMocks();
		boolInputs["dry-run"] = true;

		await run();

		expect(setOutput).toHaveBeenCalledWith("flutter-version", "3.29.3");
		expect(setOutput).toHaveBeenCalledWith("dart-version", "3.7.0");
		expect(setOutput).toHaveBeenCalledWith("channel", "stable");
		expect(installFromArchive).not.toHaveBeenCalled();
		expect(restoreSdkCache).not.toHaveBeenCalled();
	});

	it("calls setFailed on error", async () => {
		setupDefaultMocks();
		vi.mocked(resolveFromManifest).mockReturnValue(null);

		await run();

		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining("No Flutter release found"),
		);
	});

	it("uses git mode with ref spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});

		await run();

		expect(resolveGitRef).toHaveBeenCalled();
		expect(installFromGit).toHaveBeenCalled();
		expect(installFromArchive).not.toHaveBeenCalled();
	});

	it("uses git mode with exact version spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "3.29.0";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"3.29.0",
			expect.anything(),
		);
	});

	it("uses git mode with channel spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs.channel = "beta";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "channel",
			channel: "beta",
		});

		await run();

		expect(resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"beta",
			expect.anything(),
		);
	});

	it("uses git mode with range spec falls back to channel", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "range",
			major: 3,
			minor: undefined,
		});

		await run();

		expect(resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"stable",
			expect.anything(),
		);
	});

	it("uses git mode with constraint spec falls back to channel", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "constraint",
			range: ">=3.29.0 <4.0.0",
		});

		await run();

		expect(resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"stable",
			expect.anything(),
		);
	});

	it("uses git mode with cache hit skips install", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		vi.mocked(parseVersionSpec).mockReturnValue({ type: "any" });
		vi.mocked(restoreSdkCache).mockResolvedValue(true);

		await run();

		expect(resolveGitRef).toHaveBeenCalled();
		expect(installFromGit).not.toHaveBeenCalled();
	});

	it("reads version file when flutter-version is empty", async () => {
		const { inputs } = setupDefaultMocks();
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
		setupDefaultMocks();
		vi.mocked(fetchManifest).mockRejectedValue(new Error("Network error"));

		await run();

		expect(setFailed).toHaveBeenCalledWith("Network error");
	});

	it("uses git mode with fork repo (no manifest)", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});
		vi.mocked(isOriginalRepo).mockReturnValue(false);

		await run();

		expect(fetchManifest).not.toHaveBeenCalled();
		expect(resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"my-branch",
			undefined,
		);
	});

	it("uses git mode with empty version fallback to gitRef", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		vi.mocked(parseVersionSpec).mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});
		vi.mocked(resolveGitRef).mockResolvedValue({
			commitHash: "hash1",
			version: undefined,
		});

		await run();

		expect(setOutput).toHaveBeenCalledWith("flutter-version", "my-branch");
	});

	it("sets cache-pub-hit to true when pub cache hits", async () => {
		setupDefaultMocks();
		vi.mocked(restorePubCache).mockResolvedValue(true);

		await run();

		expect(restorePubCache).toHaveBeenCalled();
		expect(setOutput).toHaveBeenCalledWith("cache-pub-hit", "true");
	});

	it("skips pub cache restore when pubCacheKey returns null", async () => {
		setupDefaultMocks();
		vi.mocked(pubCacheKey).mockReturnValue(null);

		await run();

		expect(restorePubCache).not.toHaveBeenCalled();
	});

	it("calls setFailed with String for non-Error thrown", async () => {
		setupDefaultMocks();
		vi.mocked(fetchManifest).mockRejectedValue("string error");

		await run();

		expect(setFailed).toHaveBeenCalledWith("string error");
	});

	it("calls setFailed when readVersionFile throws", async () => {
		const { inputs } = setupDefaultMocks();
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
