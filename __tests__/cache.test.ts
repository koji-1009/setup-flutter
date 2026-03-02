import * as fs from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mocked,
	vi,
} from "vitest";
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

const mockedCache = cache as Mocked<typeof cache>;
const mockedCore = core as Mocked<typeof core>;

const fixturesDir = path.join(__dirname, "fixtures");

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
		vi.mocked(fs.existsSync).mockReset();
	});

	it("returns true when flutter binary exists", () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		expect(isValidLocalSdk("/opt/flutter")).toBe(true);
	});

	it("returns false when flutter binary does not exist", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);
		expect(isValidLocalSdk("/opt/flutter")).toBe(false);
	});
});

describe("restoreSdkCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true on cache hit", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);
		mockedCache.restoreCache.mockResolvedValue(
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(true);
	});

	it("returns false on cache miss", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);
		mockedCache.restoreCache.mockResolvedValue(undefined);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(false);
	});

	it("returns false and warns on error", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);
		mockedCache.restoreCache.mockRejectedValue(new Error("Cache error"));
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(false);
		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("SDK cache restore failed"),
		);
	});

	it("returns true without restoring when SDK exists locally", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		const result = await restoreSdkCache(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.0-x64",
		);
		expect(result).toBe(true);
		expect(mockedCache.restoreCache).not.toHaveBeenCalled();
		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("found locally"),
		);
	});
});

describe("saveSdkCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("saves cache successfully", async () => {
		mockedCache.saveCache.mockResolvedValue(1);
		await saveSdkCache("/opt/flutter", "key1");
		expect(mockedCache.saveCache).toHaveBeenCalledWith(
			["/opt/flutter"],
			"key1",
		);
	});

	it("logs info on ReserveCacheError", async () => {
		const error = new Error("Cache already exists");
		error.name = "ReserveCacheError";
		mockedCache.saveCache.mockRejectedValue(error);
		await saveSdkCache("/opt/flutter", "key1");
		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("already exists"),
		);
	});

	it("warns on other errors", async () => {
		mockedCache.saveCache.mockRejectedValue(new Error("Some error"));
		await saveSdkCache("/opt/flutter", "key1");
		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("SDK cache save failed"),
		);
	});
});

describe("pubCacheKey", () => {
	it("returns key when lockfile exists", () => {
		const lockfilePath = path.join(fixturesDir, "pubspec.lock");
		const key = pubCacheKey(lockfilePath);
		expect(key).toMatch(/^flutter-pub-[a-f0-9]{16}$/);
	});

	it("returns null when lockfile does not exist", () => {
		const key = pubCacheKey("/nonexistent/pubspec.lock");
		expect(key).toBeNull();
		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		);
	});

	it("returns different key for different lockfile content", () => {
		const key1 = pubCacheKey(path.join(fixturesDir, "pubspec.lock"));
		const key2 = pubCacheKey(path.join(fixturesDir, "pubspec-alt.lock"));
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
		mockedCache.restoreCache.mockResolvedValue("key");
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(true);
	});

	it("returns false on cache miss", async () => {
		mockedCache.restoreCache.mockResolvedValue(undefined);
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(false);
	});

	it("returns false and warns on error", async () => {
		mockedCache.restoreCache.mockRejectedValue(new Error("error"));
		const result = await restorePubCache(["/pub-cache"], "key");
		expect(result).toBe(false);
		expect(mockedCore.warning).toHaveBeenCalled();
	});
});

describe("savePubCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("saves cache when directory is not empty", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readdirSync).mockReturnValue([
			"file1",
		] as unknown as ReturnType<typeof fs.readdirSync>);
		mockedCache.saveCache.mockResolvedValue(1);
		await savePubCache(["/pub-cache"], "key");
		expect(mockedCache.saveCache).toHaveBeenCalled();
	});

	it("skips save when directory is empty", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readdirSync).mockReturnValue(
			[] as unknown as ReturnType<typeof fs.readdirSync>,
		);
		await savePubCache(["/pub-cache"], "key");
		expect(mockedCache.saveCache).not.toHaveBeenCalled();
		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("empty"),
		);
	});

	it("skips save when directory does not exist", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);
		await savePubCache(["/pub-cache"], "key");
		expect(mockedCache.saveCache).not.toHaveBeenCalled();
	});

	it("logs info on ReserveCacheError", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readdirSync).mockReturnValue([
			"file1",
		] as unknown as ReturnType<typeof fs.readdirSync>);
		const error = new Error("Cache already exists");
		error.name = "ReserveCacheError";
		mockedCache.saveCache.mockRejectedValue(error);
		await savePubCache(["/pub-cache"], "key");
		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("already exists"),
		);
	});

	it("warns on other save errors", async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readdirSync).mockReturnValue([
			"file1",
		] as unknown as ReturnType<typeof fs.readdirSync>);
		mockedCache.saveCache.mockRejectedValue(new Error("network error"));
		await savePubCache(["/pub-cache"], "key");
		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("network error"),
		);
	});
});
