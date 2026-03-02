import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { restoreCache, saveCache } from "@actions/cache";
import { info, warning } from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getPubCachePaths,
	isValidLocalSdk,
	pubCacheKey,
	restorePubCache,
	restoreSdkCache,
	savePubCache,
	saveSdkCache,
	sdkCacheKey,
	sdkCachePath,
} from "../src/cache";

vi.mock("@actions/cache");
vi.mock("@actions/core");
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
		readdirSync: vi.fn(actual.readdirSync),
	};
});

const fixturesDir = join(__dirname, "fixtures");

describe("sdkCacheKey", () => {
	it("returns release cache key", () => {
		expect(sdkCacheKey("linux", "stable", "3.29.0", "x64")).toBe(
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
	});

	it("returns different key for different os", () => {
		expect(sdkCacheKey("macos", "stable", "3.29.0", "x64")).toBe(
			"flutter-sdk-macos-stable-3.29.0-x64",
		);
	});

	it("returns different key for different channel", () => {
		expect(sdkCacheKey("linux", "beta", "3.29.0", "x64")).toBe(
			"flutter-sdk-linux-beta-3.29.0-x64",
		);
	});

	it("returns different key for different version", () => {
		expect(sdkCacheKey("linux", "stable", "3.30.0", "x64")).toBe(
			"flutter-sdk-linux-stable-3.30.0-x64",
		);
	});

	it("returns different key for different arch", () => {
		expect(sdkCacheKey("linux", "stable", "3.29.0", "arm64")).toBe(
			"flutter-sdk-linux-stable-3.29.0-arm64",
		);
	});

	it("returns git cache key", () => {
		const key = sdkCacheKey("linux", "stable", "3.29.0", "x64", {
			commitHash: "abc1234567890",
			urlHash: "url12345",
		});
		expect(key).toBe("flutter-sdk-linux-git-abc1234567890-x64-url12345");
	});
});

describe("sdkCachePath", () => {
	it("returns release cache path", () => {
		const result = sdkCachePath("3.29.0", "stable", "x64");
		expect(result).toContain("flutter");
		expect(result).toContain("3.29.0-stable-x64");
	});

	it("returns git cache path", () => {
		const result = sdkCachePath("3.29.0", "stable", "x64", {
			commitHash: "abc1234567890",
		});
		expect(result).toContain("git-abc1234-x64");
	});

	it("uses RUNNER_TOOL_CACHE env var", () => {
		const original = process.env.RUNNER_TOOL_CACHE;
		process.env.RUNNER_TOOL_CACHE = "/custom/cache";
		const result = sdkCachePath("3.29.0", "stable", "x64");
		expect(result).toContain("/custom/cache");
		if (original === undefined) {
			delete process.env.RUNNER_TOOL_CACHE;
		} else {
			process.env.RUNNER_TOOL_CACHE = original;
		}
	});
});

describe("isValidLocalSdk", () => {
	afterEach(() => {
		vi.mocked(existsSync).mockReset();
	});

	it("returns true when flutter binary exists", () => {
		vi.mocked(existsSync).mockReturnValue(true);
		expect(isValidLocalSdk("/opt/flutter")).toBe(true);
	});

	it("returns false when flutter binary does not exist", () => {
		vi.mocked(existsSync).mockReturnValue(false);
		expect(isValidLocalSdk("/opt/flutter")).toBe(false);
	});
});

describe("restoreSdkCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true on cache hit", async () => {
		vi.mocked(existsSync).mockReturnValue(false);
		vi.mocked(restoreCache).mockResolvedValue(
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(true);
	});

	it("returns false on cache miss", async () => {
		vi.mocked(existsSync).mockReturnValue(false);
		vi.mocked(restoreCache).mockResolvedValue(undefined);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(false);
	});

	it("returns false and warns on error", async () => {
		vi.mocked(existsSync).mockReturnValue(false);
		vi.mocked(restoreCache).mockRejectedValue(new Error("Cache error"));
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(false);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("SDK cache restore failed"),
		);
	});

	it("returns true without restoring when SDK exists locally", async () => {
		vi.mocked(existsSync).mockReturnValue(true);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(true);
		expect(restoreCache).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(expect.stringContaining("found locally"));
	});
});

describe("saveSdkCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("saves cache successfully", async () => {
		vi.mocked(saveCache).mockResolvedValue(1);
		await saveSdkCache("/opt/flutter", "key1");
		expect(saveCache).toHaveBeenCalledWith(["/opt/flutter"], "key1");
	});

	it("logs info on ReserveCacheError", async () => {
		const error = new Error("Cache already exists");
		error.name = "ReserveCacheError";
		vi.mocked(saveCache).mockRejectedValue(error);
		await saveSdkCache("/opt/flutter", "key1");
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining("already exists"),
		);
	});

	it("warns on other errors", async () => {
		vi.mocked(saveCache).mockRejectedValue(new Error("Some error"));
		await saveSdkCache("/opt/flutter", "key1");
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("SDK cache save failed"),
		);
	});
});

describe("pubCacheKey", () => {
	it("returns key when lockfile exists", () => {
		const lockfilePath = join(fixturesDir, "pubspec.lock");
		const key = pubCacheKey(lockfilePath);
		expect(key).toMatch(/^flutter-pub-[a-f0-9]{16}$/);
	});

	it("returns null when lockfile does not exist", () => {
		const key = pubCacheKey("/nonexistent/pubspec.lock");
		expect(key).toBeNull();
		expect(info).toHaveBeenCalledWith(expect.stringContaining("not found"));
	});

	it("returns different key for different lockfile content", () => {
		const key1 = pubCacheKey(join(fixturesDir, "pubspec.lock"));
		const key2 = pubCacheKey(join(fixturesDir, "pubspec-alt.lock"));
		expect(key1).not.toBe(key2);
	});
});

describe("getPubCachePaths", () => {
	it("returns array with pub cache path", () => {
		expect(getPubCachePaths("/home/user/.pub-cache")).toEqual([
			"/home/user/.pub-cache",
		]);
	});
});

describe("restorePubCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true on cache hit", async () => {
		vi.mocked(restoreCache).mockResolvedValue("key");
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(true);
	});

	it("returns false on cache miss", async () => {
		vi.mocked(restoreCache).mockResolvedValue(undefined);
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(false);
	});

	it("returns false and warns on error", async () => {
		vi.mocked(restoreCache).mockRejectedValue(new Error("error"));
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(false);
		expect(warning).toHaveBeenCalled();
	});
});

describe("savePubCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("saves cache when directory is not empty", async () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(["file1"] as unknown as ReturnType<
			typeof readdirSync
		>);
		vi.mocked(saveCache).mockResolvedValue(1);
		await savePubCache(["/pub-cache"], "key");
		expect(saveCache).toHaveBeenCalled();
	});

	it("skips save when directory is empty", async () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(
			[] as unknown as ReturnType<typeof readdirSync>,
		);
		await savePubCache(["/pub-cache"], "key");
		expect(saveCache).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(expect.stringContaining("empty"));
	});

	it("skips save when directory does not exist", async () => {
		vi.mocked(existsSync).mockReturnValue(false);
		await savePubCache(["/pub-cache"], "key");
		expect(saveCache).not.toHaveBeenCalled();
	});

	it("logs info on ReserveCacheError", async () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(["file1"] as unknown as ReturnType<
			typeof readdirSync
		>);
		const error = new Error("Cache already exists");
		error.name = "ReserveCacheError";
		vi.mocked(saveCache).mockRejectedValue(error);
		await savePubCache(["/pub-cache"], "key");
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining("already exists"),
		);
	});

	it("warns on other save errors", async () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(["file1"] as unknown as ReturnType<
			typeof readdirSync
		>);
		vi.mocked(saveCache).mockRejectedValue(new Error("network error"));
		await savePubCache(["/pub-cache"], "key");
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("network error"),
		);
	});
});
