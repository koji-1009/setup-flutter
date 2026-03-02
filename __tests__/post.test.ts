import { getState, info, warning } from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPubCachePaths, savePubCache, saveSdkCache } from "../src/cache";

vi.mock("@actions/core");
vi.mock("../src/cache");

const { run } = await import("../src/post");

function setupState(state: Record<string, string>) {
	vi.mocked(getState).mockImplementation((name: string) => state[name] || "");
	vi.mocked(info).mockImplementation(() => {});
	vi.mocked(saveSdkCache).mockResolvedValue();
	vi.mocked(savePubCache).mockResolvedValue();
	vi.mocked(getPubCachePaths).mockReturnValue(["/home/runner/.pub-cache"]);
}

describe("post run()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips save when installSuccess is false", async () => {
		setupState({ installSuccess: "false" });
		await run();

		expect(info).toHaveBeenCalledWith(
			expect.stringContaining("did not complete"),
		);
		expect(saveSdkCache).not.toHaveBeenCalled();
		expect(savePubCache).not.toHaveBeenCalled();
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

		expect(saveSdkCache).toHaveBeenCalledWith(
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

		expect(saveSdkCache).not.toHaveBeenCalled();
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

		expect(savePubCache).toHaveBeenCalledWith(
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

		expect(savePubCache).not.toHaveBeenCalled();
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

		expect(saveSdkCache).not.toHaveBeenCalled();
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

		expect(savePubCache).not.toHaveBeenCalled();
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
		vi.mocked(warning).mockImplementation(() => {});
		vi.mocked(saveSdkCache).mockRejectedValue("string error");

		await run();

		expect(warning).toHaveBeenCalledWith("Post action failed: string error");
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
		vi.mocked(warning).mockImplementation(() => {});
		vi.mocked(saveSdkCache).mockRejectedValue(new Error("unexpected"));

		await run();

		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Post action failed"),
		);
	});
});
