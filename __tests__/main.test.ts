import * as core from "@actions/core";
import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import * as cacheModule from "../src/cache";
import * as gitSource from "../src/git-source";
import * as installer from "../src/installer";
import * as utils from "../src/utils";
import * as version from "../src/version";
import * as versionFile from "../src/version-file";

vi.mock("@actions/core");
vi.mock("../src/utils");
vi.mock("../src/version");
vi.mock("../src/version-file");
vi.mock("../src/installer");
vi.mock("../src/cache");
vi.mock("../src/git-source");

const mockedCore = core as Mocked<typeof core>;
const mockedUtils = utils as Mocked<typeof utils>;
const mockedVersion = version as Mocked<typeof version>;
const mockedVersionFile = versionFile as Mocked<typeof versionFile>;
const mockedInstaller = installer as Mocked<typeof installer>;
const mockedCacheModule = cacheModule as Mocked<typeof cacheModule>;
const mockedGitSource = gitSource as Mocked<typeof gitSource>;

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

	mockedCore.getInput.mockImplementation((name: string) => inputs[name] || "");
	mockedCore.getBooleanInput.mockImplementation(
		(name: string) => boolInputs[name] ?? false,
	);
	mockedCore.setOutput.mockImplementation(() => {});
	mockedCore.saveState.mockImplementation(() => {});
	mockedCore.setFailed.mockImplementation(() => {});
	mockedCore.warning.mockImplementation(() => {});
	mockedCore.info.mockImplementation(() => {});
	mockedCore.exportVariable.mockImplementation(() => {});

	mockedUtils.getPlatform.mockReturnValue("linux");
	mockedUtils.getArch.mockReturnValue("x64");
	mockedUtils.getPubCachePath.mockReturnValue("/home/runner/.pub-cache");

	mockedVersion.parseVersionSpec.mockReturnValue({ type: "any" });
	mockedVersion.fetchManifest.mockResolvedValue(defaultManifest);
	mockedVersion.resolveFromManifest.mockReturnValue(defaultResolved);

	mockedInstaller.installFromArchive.mockResolvedValue("/opt/flutter");
	mockedInstaller.setupPath.mockImplementation(() => {});

	mockedCacheModule.sdkCacheKey.mockReturnValue(
		"flutter-sdk-linux-stable-3.29.3-x64",
	);
	mockedCacheModule.sdkCachePath.mockReturnValue(
		"/opt/hostedtoolcache/flutter/3.29.3-stable-x64",
	);
	mockedCacheModule.restoreSdkCache.mockResolvedValue(false);
	mockedCacheModule.pubCacheKey.mockReturnValue("flutter-pub-abc123");
	mockedCacheModule.restorePubCache.mockResolvedValue(false);
	mockedCacheModule.getPubCachePaths.mockReturnValue([
		"/home/runner/.pub-cache",
	]);

	mockedGitSource.isOriginalRepo.mockReturnValue(true);
	mockedGitSource.resolveGitRef.mockResolvedValue({
		commitHash: "hash1",
		version: "3.29.3",
	});
	mockedGitSource.installFromGit.mockResolvedValue();

	return { inputs, boolInputs };
}

describe("main run()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("installs latest stable with zero config", async () => {
		setupDefaultMocks();
		await run();

		expect(mockedVersion.fetchManifest).toHaveBeenCalledWith("linux");
		expect(mockedVersion.resolveFromManifest).toHaveBeenCalled();
		expect(mockedInstaller.installFromArchive).toHaveBeenCalled();
		expect(mockedInstaller.setupPath).toHaveBeenCalled();
		expect(mockedCore.setOutput).toHaveBeenCalledWith(
			"flutter-version",
			"3.29.3",
		);
		expect(mockedCore.saveState).toHaveBeenCalledWith("installSuccess", "true");
	});

	it("resolves exact version", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["flutter-version"] = "3.29.0";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(mockedVersion.parseVersionSpec).toHaveBeenCalledWith("3.29.0");
		expect(mockedVersion.resolveFromManifest).toHaveBeenCalled();
	});

	it("warns when both flutter-version and flutter-version-file are specified", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["flutter-version"] = "3.29.0";
		inputs["flutter-version-file"] = "pubspec.yaml";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("Both flutter-version and flutter-version-file"),
		);
		expect(mockedVersionFile.readVersionFile).not.toHaveBeenCalled();
	});

	it("overrides channel when version spec is a channel and warns", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["flutter-version-file"] = ".fvmrc";
		mockedVersionFile.readVersionFile.mockResolvedValue("beta");
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "channel",
			channel: "beta",
		});

		await run();

		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("overriding input 'stable'"),
		);
	});

	it("does not restore cache when cache-sdk is false", async () => {
		const { boolInputs } = setupDefaultMocks();
		boolInputs["cache-sdk"] = false;

		await run();

		expect(mockedCacheModule.restoreSdkCache).not.toHaveBeenCalled();
	});

	it("skips pub cache when cache-pub is false", async () => {
		const { boolInputs } = setupDefaultMocks();
		boolInputs["cache-pub"] = false;

		await run();

		expect(mockedCacheModule.pubCacheKey).not.toHaveBeenCalled();
		expect(mockedCacheModule.restorePubCache).not.toHaveBeenCalled();
	});

	it("does not install when cache hit", async () => {
		setupDefaultMocks();
		mockedCacheModule.restoreSdkCache.mockResolvedValue(true);

		await run();

		expect(mockedInstaller.installFromArchive).not.toHaveBeenCalled();
	});

	it("handles dry-run: sets outputs but does not install", async () => {
		const { boolInputs } = setupDefaultMocks();
		boolInputs["dry-run"] = true;

		await run();

		expect(mockedCore.setOutput).toHaveBeenCalledWith(
			"flutter-version",
			"3.29.3",
		);
		expect(mockedCore.setOutput).toHaveBeenCalledWith("dart-version", "3.7.0");
		expect(mockedCore.setOutput).toHaveBeenCalledWith("channel", "stable");
		expect(mockedInstaller.installFromArchive).not.toHaveBeenCalled();
		expect(mockedCacheModule.restoreSdkCache).not.toHaveBeenCalled();
	});

	it("calls setFailed on error", async () => {
		setupDefaultMocks();
		mockedVersion.resolveFromManifest.mockReturnValue(null);

		await run();

		expect(mockedCore.setFailed).toHaveBeenCalledWith(
			expect.stringContaining("No Flutter release found"),
		);
	});

	it("uses git mode with ref spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});

		await run();

		expect(mockedGitSource.resolveGitRef).toHaveBeenCalled();
		expect(mockedGitSource.installFromGit).toHaveBeenCalled();
		expect(mockedInstaller.installFromArchive).not.toHaveBeenCalled();
	});

	it("uses git mode with exact version spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "3.29.0";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "exact",
			version: "3.29.0",
		});

		await run();

		expect(mockedGitSource.resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"3.29.0",
			expect.anything(),
		);
	});

	it("uses git mode with channel spec", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs.channel = "beta";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "channel",
			channel: "beta",
		});

		await run();

		expect(mockedGitSource.resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"beta",
			expect.anything(),
		);
	});

	it("uses git mode with range spec falls back to channel", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs.channel = "stable";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "range",
			major: 3,
			minor: undefined,
		});

		await run();

		expect(mockedGitSource.resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"stable",
			expect.anything(),
		);
	});

	it("uses git mode with cache hit skips install", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		mockedVersion.parseVersionSpec.mockReturnValue({ type: "any" });
		mockedCacheModule.restoreSdkCache.mockResolvedValue(true);

		await run();

		expect(mockedGitSource.resolveGitRef).toHaveBeenCalled();
		expect(mockedGitSource.installFromGit).not.toHaveBeenCalled();
	});

	it("reads version file when flutter-version is empty", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["flutter-version-file"] = "pubspec.yaml";
		mockedVersionFile.readVersionFile.mockResolvedValue(">=3.29.0 <4.0.0");
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "constraint",
			range: ">=3.29.0 <4.0.0",
		});

		await run();

		expect(mockedVersionFile.readVersionFile).toHaveBeenCalledWith(
			"pubspec.yaml",
			undefined,
		);
		expect(mockedVersion.parseVersionSpec).toHaveBeenCalledWith(
			">=3.29.0 <4.0.0",
		);
	});

	it("calls setFailed when fetchManifest throws", async () => {
		setupDefaultMocks();
		mockedVersion.fetchManifest.mockRejectedValue(new Error("Network error"));

		await run();

		expect(mockedCore.setFailed).toHaveBeenCalledWith("Network error");
	});

	it("uses git mode with fork repo (no manifest)", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});
		mockedGitSource.isOriginalRepo.mockReturnValue(false);

		await run();

		expect(mockedVersion.fetchManifest).not.toHaveBeenCalled();
		expect(mockedGitSource.resolveGitRef).toHaveBeenCalledWith(
			"https://github.com/flutter/flutter.git",
			"my-branch",
			undefined,
		);
	});

	it("uses git mode with empty version fallback to gitRef", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["git-source"] = "git";
		inputs["flutter-version"] = "my-branch";
		mockedVersion.parseVersionSpec.mockReturnValue({
			type: "ref",
			ref: "my-branch",
		});
		mockedGitSource.resolveGitRef.mockResolvedValue({
			commitHash: "hash1",
			version: undefined,
		});

		await run();

		expect(mockedCore.setOutput).toHaveBeenCalledWith(
			"flutter-version",
			"my-branch",
		);
	});

	it("skips pub cache restore when pubCacheKey returns null", async () => {
		setupDefaultMocks();
		mockedCacheModule.pubCacheKey.mockReturnValue(null);

		await run();

		expect(mockedCacheModule.restorePubCache).not.toHaveBeenCalled();
	});

	it("calls setFailed with String for non-Error thrown", async () => {
		setupDefaultMocks();
		mockedVersion.fetchManifest.mockRejectedValue("string error");

		await run();

		expect(mockedCore.setFailed).toHaveBeenCalledWith("string error");
	});

	it("calls setFailed when readVersionFile throws", async () => {
		const { inputs } = setupDefaultMocks();
		inputs["flutter-version-file"] = "pubspec.yaml";
		mockedVersionFile.readVersionFile.mockRejectedValue(
			new Error("pubspec.yaml does not contain environment.flutter"),
		);

		await run();

		expect(mockedCore.setFailed).toHaveBeenCalledWith(
			"pubspec.yaml does not contain environment.flutter",
		);
	});
});
