import * as core from "@actions/core";
import { getPubCachePaths, savePubCache, saveSdkCache } from "./cache";

export async function run(): Promise<void> {
	try {
		const installSuccess = core.getState("installSuccess") === "true";
		if (!installSuccess) {
			core.info("Installation did not complete, skipping cache save");
			return;
		}

		const cacheSdk = core.getState("cacheSdk") === "true";
		const cachePub = core.getState("cachePub") === "true";
		const sdkCacheMiss = core.getState("sdkCacheMiss") === "true";
		const pubCacheMiss = core.getState("pubCacheMiss") === "true";

		if (cacheSdk && sdkCacheMiss) {
			const key = core.getState("sdkCacheKey");
			const sdkPath = core.getState("sdkCachePath");
			if (key && sdkPath) {
				await saveSdkCache(sdkPath, key);
			}
		}

		if (cachePub && pubCacheMiss) {
			const key = core.getState("pubCacheKey");
			const pubCachePath = core.getState("pubCachePath");
			if (key && pubCachePath) {
				await savePubCache(getPubCachePaths(pubCachePath), key, pubCachePath);
			}
		}
	} catch (error) {
		core.warning(
			`Post action failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

run();
