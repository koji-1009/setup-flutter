import { getState, info, warning } from "@actions/core";
import { getPubCachePaths, savePubCache, saveSdkCache } from "./cache";

export async function run(): Promise<void> {
	try {
		const installSuccess = getState("installSuccess") === "true";
		if (!installSuccess) {
			info("Installation did not complete, skipping cache save");
			return;
		}

		const cacheSdk = getState("cacheSdk") === "true";
		const cachePub = getState("cachePub") === "true";
		const sdkCacheMiss = getState("sdkCacheMiss") === "true";
		const pubCacheMiss = getState("pubCacheMiss") === "true";

		if (cacheSdk && sdkCacheMiss) {
			const key = getState("sdkCacheKey");
			const sdkPath = getState("sdkCachePath");
			if (key && sdkPath) {
				info("Saving SDK cache...");
				await saveSdkCache(sdkPath, key);
			}
		}

		if (cachePub && pubCacheMiss) {
			const key = getState("pubCacheKey");
			const pubCachePath = getState("pubCachePath");
			if (key && pubCachePath) {
				info("Saving pub cache...");
				await savePubCache(getPubCachePaths(pubCachePath), key);
			}
		}
	} catch (error) {
		warning(
			`Post action failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

run();
