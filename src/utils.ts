import * as os from "node:os";
import * as path from "node:path";

export function getPlatform(): "linux" | "macos" | "windows" {
	switch (process.platform) {
		case "linux":
			return "linux";
		case "darwin":
			return "macos";
		case "win32":
			return "windows";
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export function getArch(input?: string): "x64" | "arm64" {
	if (input) {
		if (input === "x64" || input === "arm64") return input;
		throw new Error(`Unsupported architecture: ${input}`);
	}
	switch (process.arch) {
		case "x64":
			return "x64";
		case "arm64":
			return "arm64";
		default:
			throw new Error(`Unsupported architecture: ${process.arch}`);
	}
}

export function getPubCachePath(): string {
	if (process.env.PUB_CACHE) return process.env.PUB_CACHE;
	const platform = getPlatform();
	if (platform === "windows") {
		return path.join(process.env.LOCALAPPDATA || "", "Pub", "Cache");
	}
	return path.join(os.homedir(), ".pub-cache");
}

export function getStorageBaseUrl(): string {
	return (
		process.env.FLUTTER_STORAGE_BASE_URL || "https://storage.googleapis.com"
	);
}

export function getManifestUrl(platform: string): string {
	return `${getStorageBaseUrl()}/flutter_infra_release/releases/releases_${platform}.json`;
}
