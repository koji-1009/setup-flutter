import * as core from "@actions/core";
import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import * as cacheModule from "../src/cache";

vi.mock("@actions/core");
vi.mock("../src/cache");

const mockedCore = core as Mocked<typeof core>;
const mockedCacheModule = cacheModule as Mocked<typeof cacheModule>;

const { run } = await import("../src/post");

function setupState(state: Record<string, string>) {
	mockedCore.getState.mockImplementation((name: string) => state[name] || "");
	mockedCore.info.mockImplementation(() => {});
	mockedCacheModule.saveSdkCache.mockResolvedValue();
	mockedCacheModule.savePubCache.mockResolvedValue();
	mockedCacheModule.getPubCachePaths.mockReturnValue([
		"/home/runner/.pub-cache",
	]);
}

describe("post run()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips save when installSuccess is false", async () => {
		setupState({ installSuccess: "false" });
		await run();

		expect(mockedCore.info).toHaveBeenCalledWith(
			expect.stringContaining("did not complete"),
		);
		expect(mockedCacheModule.saveSdkCache).not.toHaveBeenCalled();
		expect(mockedCacheModule.savePubCache).not.toHaveBeenCalled();
	});

	it("saves SDK cache when installSuccess and sdkCacheMiss are true", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "true",
			sdkCacheMiss: "true",
			sdkCacheKey: "flutter-sdk-linux-stable-3.29.3-x64",
			sdkCachePath: "/opt/flutter",
			cachePub: "false",
			pubCacheMiss: "false",
		});
		await run();

		expect(mockedCacheModule.saveSdkCache).toHaveBeenCalledWith(
			"/opt/flutter",
			"flutter-sdk-linux-stable-3.29.3-x64",
		);
	});

	it("does not save SDK cache when sdkCacheMiss is false", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "true",
			sdkCacheMiss: "false",
			cachePub: "false",
			pubCacheMiss: "false",
		});
		await run();

		expect(mockedCacheModule.saveSdkCache).not.toHaveBeenCalled();
	});

	it("saves pub cache when installSuccess and pubCacheMiss are true", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "false",
			sdkCacheMiss: "false",
			cachePub: "true",
			pubCacheMiss: "true",
			pubCacheKey: "flutter-pub-linux-abc123",
			pubCachePath: "/home/runner/.pub-cache",
		});
		await run();

		expect(mockedCacheModule.savePubCache).toHaveBeenCalledWith(
			["/home/runner/.pub-cache"],
			"flutter-pub-linux-abc123",
		);
	});

	it("does not save pub cache when pubCacheMiss is false", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "false",
			sdkCacheMiss: "false",
			cachePub: "true",
			pubCacheMiss: "false",
		});
		await run();

		expect(mockedCacheModule.savePubCache).not.toHaveBeenCalled();
	});

	it("skips SDK save when state keys are empty", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "true",
			sdkCacheMiss: "true",
			sdkCacheKey: "",
			sdkCachePath: "",
			cachePub: "false",
			pubCacheMiss: "false",
		});
		await run();

		expect(mockedCacheModule.saveSdkCache).not.toHaveBeenCalled();
	});

	it("skips pub save when state keys are empty", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "false",
			sdkCacheMiss: "false",
			cachePub: "true",
			pubCacheMiss: "true",
			pubCacheKey: "",
			pubCachePath: "",
		});
		await run();

		expect(mockedCacheModule.savePubCache).not.toHaveBeenCalled();
	});

	it("catches non-Error and calls core.warning with String", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "true",
			sdkCacheMiss: "true",
			sdkCacheKey: "key",
			sdkCachePath: "/opt/flutter",
			cachePub: "false",
			pubCacheMiss: "false",
		});
		mockedCore.warning.mockImplementation(() => {});
		mockedCacheModule.saveSdkCache.mockRejectedValue("string error");

		await run();

		expect(mockedCore.warning).toHaveBeenCalledWith(
			"Post action failed: string error",
		);
	});

	it("catches errors and calls core.warning", async () => {
		setupState({
			installSuccess: "true",
			cacheSdk: "true",
			sdkCacheMiss: "true",
			sdkCacheKey: "key",
			sdkCachePath: "/opt/flutter",
			cachePub: "false",
			pubCacheMiss: "false",
		});
		mockedCore.warning.mockImplementation(() => {});
		mockedCacheModule.saveSdkCache.mockRejectedValue(new Error("unexpected"));

		await run();

		expect(mockedCore.warning).toHaveBeenCalledWith(
			expect.stringContaining("Post action failed"),
		);
	});
});
