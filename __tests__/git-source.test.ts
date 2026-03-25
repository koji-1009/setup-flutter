import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "@actions/exec";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	installFromGit,
	isOriginalRepo,
	resolveGitRef,
} from "../src/git-source";
import type { FlutterManifest } from "../src/version";

vi.mock("@actions/exec");
vi.mock("@actions/core");

const fixture: FlutterManifest = JSON.parse(
	readFileSync(join(__dirname, "fixtures", "releases_linux.json"), "utf8"),
);

describe("isOriginalRepo", () => {
	it("returns true for flutter/flutter.git", () => {
		expect(isOriginalRepo("https://github.com/flutter/flutter.git")).toBe(true);
	});

	it("returns true for flutter/flutter without .git", () => {
		expect(isOriginalRepo("https://github.com/flutter/flutter")).toBe(true);
	});

	it("returns true case-insensitively", () => {
		expect(isOriginalRepo("https://github.com/Flutter/Flutter.git")).toBe(true);
	});

	it("returns false for other repos", () => {
		expect(isOriginalRepo("https://github.com/user/flutter-fork.git")).toBe(
			false,
		);
	});
});

describe("resolveGitRef (original repo + manifest)", () => {
	it("resolves version ref from manifest releases", async () => {
		const result = await resolveGitRef(
			"https://github.com/flutter/flutter.git",
			"3.27.0",
			fixture,
		);
		expect(result.commitHash).toBe("8495dee1fd4aacbe9de707e7581203232f591b2f");
		expect(result.version).toBe("3.27.0");
	});

	it("resolves channel ref from current_release", async () => {
		const result = await resolveGitRef(
			"https://github.com/flutter/flutter.git",
			"stable",
			fixture,
		);
		expect(result.commitHash).toBe("90673a4eef275d1a6692c26ac80d6d746d41a73a");
		expect(result.version).toBe("3.41.2");
	});

	it("resolves commit hash prefix from manifest", async () => {
		// 8495dee1fd4aacbe9de707e7581203232f591b2f is hash for 3.27.0
		const result = await resolveGitRef(
			"https://github.com/flutter/flutter.git",
			"8495dee1fd4aacbe9de707e7581203232f591b2f",
			fixture,
		);
		expect(result.commitHash).toBe("8495dee1fd4aacbe9de707e7581203232f591b2f");
		expect(result.version).toBe("3.27.0");
	});

	it("falls back to ls-remote for master (not in current_release)", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				const data = Buffer.from("abc123def456\trefs/heads/master\n");
				options.listeners.stdout(data);
			}
			return 0;
		});

		const result = await resolveGitRef(
			"https://github.com/flutter/flutter.git",
			"master",
			fixture,
		);
		expect(result.commitHash).toBe("abc123def456");
	});
});

describe("resolveGitRef (fork)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves branch from ls-remote", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				const data = Buffer.from("deadbeef1234\trefs/heads/my-branch\n");
				options.listeners.stdout(data);
			}
			return 0;
		});

		const result = await resolveGitRef(
			"https://github.com/user/flutter-fork.git",
			"my-branch",
		);
		expect(result.commitHash).toBe("deadbeef1234");
	});

	it("resolves tag from ls-remote", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				const data = Buffer.from("cafebabe5678\trefs/tags/v1.0.0\n");
				options.listeners.stdout(data);
			}
			return 0;
		});

		const result = await resolveGitRef(
			"https://github.com/user/flutter-fork.git",
			"v1.0.0",
		);
		expect(result.commitHash).toBe("cafebabe5678");
	});

	it("returns full hash directly if ref is a 40-char commit hash", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(Buffer.from(""));
			}
			return 0;
		});

		const fullHash = "abcdef1234567890abcdef1234567890abcdef12";
		const result = await resolveGitRef(
			"https://github.com/user/flutter-fork.git",
			fullHash,
		);
		expect(result.commitHash).toBe(fullHash);
	});

	it("returns short hash with warning when not found via ls-remote", async () => {
		const { warning } = await import("@actions/core");
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(Buffer.from(""));
			}
			return 0;
		});

		const result = await resolveGitRef(
			"https://github.com/user/flutter-fork.git",
			"abc1234",
		);
		expect(result.commitHash).toBe("abc1234");
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("short commit hash"),
		);
	});

	it("throws when ref cannot be resolved", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(Buffer.from(""));
			}
			return 0;
		});

		await expect(
			resolveGitRef(
				"https://github.com/user/flutter-fork.git",
				"nonexistent-branch",
			),
		).rejects.toThrow("Could not resolve ref 'nonexistent-branch'");
	});
});

describe("installFromGit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(exec).mockResolvedValue(0);
	});

	const gitEnvMatcher = expect.objectContaining({
		env: expect.objectContaining({
			GIT_HTTP_LOW_SPEED_LIMIT: "1000",
			GIT_HTTP_LOW_SPEED_TIME: "60",
		}),
	});

	it("clones with --depth 1 --branch for branch ref", async () => {
		await installFromGit(
			"https://github.com/flutter/flutter.git",
			"stable",
			"/opt/flutter",
			"abc123def4567890abc123def4567890abc123de",
		);
		expect(exec).toHaveBeenCalledWith(
			"git",
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				"stable",
				"https://github.com/flutter/flutter.git",
				"/opt/flutter",
			],
			gitEnvMatcher,
		);
	});

	it("does full clone + checkout for commit hash ref", async () => {
		const hash = "abc123def4567890abc123def4567890abc123de";
		await installFromGit(
			"https://github.com/flutter/flutter.git",
			hash,
			"/opt/flutter",
			hash,
		);
		expect(exec).toHaveBeenCalledWith(
			"git",
			["clone", "https://github.com/flutter/flutter.git", "/opt/flutter"],
			gitEnvMatcher,
		);
		expect(exec).toHaveBeenCalledWith(
			"git",
			["-C", "/opt/flutter", "checkout", hash],
			gitEnvMatcher,
		);
	});

	it("clones with --depth 1 --branch for short hash commitHash", async () => {
		await installFromGit(
			"https://github.com/flutter/flutter.git",
			"stable",
			"/opt/flutter",
			"abc1234", // short hash, not 40 chars
		);
		expect(exec).toHaveBeenCalledWith(
			"git",
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				"stable",
				"https://github.com/flutter/flutter.git",
				"/opt/flutter",
			],
			gitEnvMatcher,
		);
	});

	it("throws when command times out", async () => {
		vi.useFakeTimers();
		vi.mocked(exec).mockReturnValue(new Promise(() => {}));

		const promise = installFromGit(
			"https://github.com/flutter/flutter.git",
			"stable",
			"/opt/flutter",
			"abc123def4567890abc123def4567890abc123de",
		);

		const assertion = expect(promise).rejects.toThrow("Command timed out");
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		await assertion;
		vi.useRealTimers();
	});

	it("propagates exec errors", async () => {
		vi.mocked(exec).mockRejectedValue(new Error("git clone failed"));

		await expect(
			installFromGit(
				"https://github.com/flutter/flutter.git",
				"stable",
				"/opt/flutter",
				"abc123def4567890abc123def4567890abc123de",
			),
		).rejects.toThrow("git clone failed");
	});

	it("calls flutter precache after clone", async () => {
		await installFromGit(
			"https://github.com/flutter/flutter.git",
			"stable",
			"/opt/flutter",
			"abc123def4567890abc123def4567890abc123de",
		);
		const calls = vi.mocked(exec).mock.calls;
		const precacheCall = calls.find(
			(c: unknown[]) => typeof c[0] === "string" && c[0].includes("flutter"),
		);
		expect(precacheCall).toBeDefined();
		expect(precacheCall?.[1]).toEqual(["precache"]);
	});
});
