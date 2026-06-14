import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "@actions/exec";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	installFromGit,
	isOriginalRepo,
	resolveGit,
	resolveGitRef,
	resolveGitVersion,
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

describe("resolveGitVersion (original repo + manifest)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves a range to the newest matching tagged version", async () => {
		const result = await resolveGitVersion(
			"https://github.com/flutter/flutter.git",
			{ type: "range", major: 3, minor: 27 },
			"stable",
			fixture,
		);
		expect(result).toEqual({
			version: "3.27.4",
			ref: "3.27.4",
			commitHash: "d8a9f9a52e5af486f80d932e838ee93861ffd863",
		});
		// Manifest is authoritative; must not shell out to ls-remote.
		expect(exec).not.toHaveBeenCalled();
	});

	it("resolves a constraint to the newest matching version", async () => {
		const result = await resolveGitVersion(
			"https://github.com/flutter/flutter.git",
			{ type: "constraint", range: ">=3.10.0 <3.11.0" },
			"stable",
			fixture,
		);
		expect(result.version).toBe("3.10.6");
		expect(result.ref).toBe("3.10.6");
	});

	it("falls back to git tags when the manifest has no match", async () => {
		// >=99.0.0 isn't in the manifest; resolve from tags instead of failing.
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(
					Buffer.from(
						"1111111111111111111111111111111111111111\trefs/tags/99.1.0\n",
					),
				);
			}
			return 0;
		});

		const result = await resolveGitVersion(
			"https://github.com/flutter/flutter.git",
			{ type: "constraint", range: ">=99.0.0" },
			"stable",
			fixture,
		);
		expect(result.version).toBe("99.1.0");
		expect(exec).toHaveBeenCalled();
	});

	it("resolves the master channel via tags (no master releases in manifest)", async () => {
		// Regression: master has no manifest entries, so the manifest lookup
		// returns null; it must fall back to tags rather than throw. master allows
		// prereleases, so the highest .pre wins.
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(
					Buffer.from(
						[
							"1111111111111111111111111111111111111111\trefs/tags/3.41.0",
							"2222222222222222222222222222222222222222\trefs/tags/3.42.0-0.1.pre",
						].join("\n"),
					),
				);
			}
			return 0;
		});

		const result = await resolveGitVersion(
			"https://github.com/flutter/flutter.git",
			{ type: "range", major: 3 },
			"master",
			fixture,
		);
		expect(result.version).toBe("3.42.0-0.1.pre");
		expect(exec).toHaveBeenCalled();
	});
});

describe("resolveGitVersion (fork via ls-remote --tags)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function mockTags(output: string) {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(Buffer.from(output));
			}
			return 0;
		});
	}

	it("picks the highest tag satisfying a range", async () => {
		// The highest match (3.27.4) is listed before a lower match (3.27.0) to
		// exercise the "don't replace the running best" path.
		mockTags(
			[
				"2222222222222222222222222222222222222222\trefs/tags/3.27.4",
				"1111111111111111111111111111111111111111\trefs/tags/3.27.0",
				"3333333333333333333333333333333333333333\trefs/tags/3.28.0",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "range", major: 3, minor: 27 },
			"stable",
		);
		expect(result).toEqual({
			version: "3.27.4",
			ref: "3.27.4",
			commitHash: "2222222222222222222222222222222222222222",
		});
		expect(exec).toHaveBeenCalledWith(
			"git",
			["ls-remote", "--tags", "https://github.com/user/flutter-fork.git"],
			expect.anything(),
		);
	});

	it("picks the highest tag satisfying a constraint", async () => {
		mockTags(
			[
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/3.10.5",
				"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/3.10.6",
				"cccccccccccccccccccccccccccccccccccccccc\trefs/tags/3.13.0",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "constraint", range: ">=3.10.0 <3.11.0" },
			"stable",
		);
		expect(result.version).toBe("3.10.6");
		expect(result.commitHash).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
	});

	it("prefers the peeled hash for annotated tags", async () => {
		mockTags(
			[
				"7777777777777777777777777777777777777777\trefs/tags/3.27.0",
				"8888888888888888888888888888888888888888\trefs/tags/3.27.0^{}",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "exact", version: "3.27.0" },
			"stable",
		);
		expect(result.commitHash).toBe("8888888888888888888888888888888888888888");
	});

	it("normalizes v-prefixed tags but keeps the original ref for checkout", async () => {
		mockTags("abcabcabcabcabcabcabcabcabcabcabcabcabca\trefs/tags/v1.12.13");

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "range", major: 1, minor: 12 },
			"stable",
		);
		expect(result.version).toBe("1.12.13");
		expect(result.ref).toBe("v1.12.13");
	});

	it("ignores non-version tags and blank lines", async () => {
		mockTags(
			[
				"1111111111111111111111111111111111111111\trefs/tags/nightly",
				"2222222222222222222222222222222222222222\trefs/tags/latest",
				"",
				"malformed-line-without-a-tab",
				"3333333333333333333333333333333333333333\trefs/heads/main",
				"4444444444444444444444444444444444444444\trefs/tags/3.29.0",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "range", major: 3 },
			"stable",
		);
		expect(result.version).toBe("3.29.0");
	});

	it("throws when no tag matches the spec", async () => {
		mockTags("1111111111111111111111111111111111111111\trefs/tags/2.0.0");

		await expect(
			resolveGitVersion(
				"https://github.com/user/flutter-fork.git",
				{ type: "range", major: 3 },
				"stable",
			),
		).rejects.toThrow("No version tag matching");
	});

	it("uses ls-remote --tags for the original repo when no manifest is given", async () => {
		mockTags("5555555555555555555555555555555555555555\trefs/tags/3.30.0");

		const result = await resolveGitVersion(
			"https://github.com/flutter/flutter.git",
			{ type: "range", major: 3, minor: 30 },
			"stable",
		);
		expect(result.version).toBe("3.30.0");
		expect(exec).toHaveBeenCalled();
	});

	it("on the stable channel, skips prerelease tags for a range", async () => {
		// Regression: previously the fork path ignored channel and rcompare ranks
		// 3.42.0-0.1.pre above 3.41.2, so a stable request installed a beta.
		mockTags(
			[
				"1111111111111111111111111111111111111111\trefs/tags/3.41.2",
				"2222222222222222222222222222222222222222\trefs/tags/3.42.0-0.1.pre",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "range", major: 3 },
			"stable",
		);
		expect(result.version).toBe("3.41.2");
		expect(result.ref).toBe("3.41.2");
	});

	it("on the stable channel, skips prerelease tags inside a constraint range", async () => {
		mockTags(
			[
				"3333333333333333333333333333333333333333\trefs/tags/3.27.4",
				"4444444444444444444444444444444444444444\trefs/tags/3.27.5-1.0.pre",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "constraint", range: ">=3.27.0 <3.28.0" },
			"stable",
		);
		expect(result.version).toBe("3.27.4");
	});

	it("on the beta channel, allows prerelease tags", async () => {
		mockTags(
			[
				"5555555555555555555555555555555555555555\trefs/tags/3.41.2",
				"6666666666666666666666666666666666666666\trefs/tags/3.42.0-0.1.pre",
			].join("\n"),
		);

		const result = await resolveGitVersion(
			"https://github.com/user/flutter-fork.git",
			{ type: "range", major: 3 },
			"beta",
		);
		expect(result.version).toBe("3.42.0-0.1.pre");
		expect(result.ref).toBe("3.42.0-0.1.pre");
	});

	it("on the stable channel, throws when only prerelease tags match", async () => {
		mockTags(
			"7777777777777777777777777777777777777777\trefs/tags/3.42.0-0.1.pre",
		);

		await expect(
			resolveGitVersion(
				"https://github.com/user/flutter-fork.git",
				{ type: "range", major: 3 },
				"stable",
			),
		).rejects.toThrow("No version tag matching");
	});
});

describe("resolveGit (dispatch)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes range/constraint specs to version resolution", async () => {
		const result = await resolveGit(
			"https://github.com/flutter/flutter.git",
			{ type: "range", major: 3, minor: 27 },
			"stable",
			fixture,
		);
		expect(result).toEqual({
			version: "3.27.4",
			ref: "3.27.4",
			commitHash: "d8a9f9a52e5af486f80d932e838ee93861ffd863",
		});
		expect(exec).not.toHaveBeenCalled();
	});

	it("resolves an exact spec via the manifest ref lookup", async () => {
		const result = await resolveGit(
			"https://github.com/flutter/flutter.git",
			{ type: "exact", version: "3.27.0" },
			"stable",
			fixture,
		);
		expect(result.version).toBe("3.27.0");
		expect(result.ref).toBe("3.27.0");
		expect(result.commitHash).toBe("8495dee1fd4aacbe9de707e7581203232f591b2f");
	});

	it("maps a channel spec to the channel ref", async () => {
		const result = await resolveGit(
			"https://github.com/flutter/flutter.git",
			{ type: "channel", channel: "stable" },
			"stable",
			fixture,
		);
		expect(result.ref).toBe("stable");
		expect(result.version).toBe("3.41.2");
	});

	it("maps an any spec to the channel ref", async () => {
		const result = await resolveGit(
			"https://github.com/flutter/flutter.git",
			{ type: "any" },
			"stable",
			fixture,
		);
		expect(result.ref).toBe("stable");
		expect(result.version).toBe("3.41.2");
	});

	it("falls back to the ref name as version for a fork ref with no manifest", async () => {
		vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
			if (options?.listeners?.stdout) {
				options.listeners.stdout(
					Buffer.from("deadbeef1234\trefs/heads/my-branch\n"),
				);
			}
			return 0;
		});

		const result = await resolveGit(
			"https://github.com/user/flutter-fork.git",
			{ type: "ref", ref: "my-branch" },
			"stable",
		);
		expect(result).toEqual({
			commitHash: "deadbeef1234",
			version: "my-branch",
			ref: "my-branch",
		});
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
