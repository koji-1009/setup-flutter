import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getArch,
	getManifestUrl,
	getPlatform,
	getPubCachePath,
	getStorageBaseUrl,
} from "../src/utils";

describe("getPlatform", () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("returns linux for linux", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		expect(getPlatform()).toBe("linux");
	});

	it("returns macos for darwin", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		expect(getPlatform()).toBe("macos");
	});

	it("returns windows for win32", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		expect(getPlatform()).toBe("windows");
	});

	it("throws for unsupported platform", () => {
		Object.defineProperty(process, "platform", { value: "freebsd" });
		expect(() => getPlatform()).toThrow("Unsupported platform: freebsd");
	});
});

describe("getArch", () => {
	const originalArch = process.arch;

	afterEach(() => {
		Object.defineProperty(process, "arch", { value: originalArch });
	});

	it("returns x64 when input is x64", () => {
		expect(getArch("x64")).toBe("x64");
	});

	it("returns arm64 when input is arm64", () => {
		expect(getArch("arm64")).toBe("arm64");
	});

	it("throws for unsupported input", () => {
		expect(() => getArch("ia32")).toThrow("Unsupported architecture: ia32");
	});

	it("returns x64 from process.arch", () => {
		Object.defineProperty(process, "arch", { value: "x64" });
		expect(getArch()).toBe("x64");
	});

	it("returns arm64 from process.arch", () => {
		Object.defineProperty(process, "arch", { value: "arm64" });
		expect(getArch()).toBe("arm64");
	});

	it("throws for unsupported process.arch", () => {
		Object.defineProperty(process, "arch", { value: "ia32" });
		expect(() => getArch()).toThrow("Unsupported architecture: ia32");
	});
});

describe("getPubCachePath", () => {
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
		process.env = { ...originalEnv };
	});

	it("returns PUB_CACHE env var if set", () => {
		process.env.PUB_CACHE = "/custom/pub-cache";
		expect(getPubCachePath()).toBe("/custom/pub-cache");
	});

	it("returns ~/.pub-cache on linux", () => {
		delete process.env.PUB_CACHE;
		Object.defineProperty(process, "platform", { value: "linux" });
		const expected = join(homedir(), ".pub-cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("returns ~/.pub-cache on macos", () => {
		delete process.env.PUB_CACHE;
		Object.defineProperty(process, "platform", { value: "darwin" });
		const expected = join(homedir(), ".pub-cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("returns LOCALAPPDATA/Pub/Cache on windows", () => {
		delete process.env.PUB_CACHE;
		Object.defineProperty(process, "platform", { value: "win32" });
		process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
		const expected = join("C:\\Users\\test\\AppData\\Local", "Pub", "Cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("throws when LOCALAPPDATA is unset on windows", () => {
		delete process.env.PUB_CACHE;
		delete process.env.LOCALAPPDATA;
		Object.defineProperty(process, "platform", { value: "win32" });
		expect(() => getPubCachePath()).toThrow(
			"LOCALAPPDATA environment variable is not set",
		);
	});
});

describe("getStorageBaseUrl", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns default URL", () => {
		delete process.env.FLUTTER_STORAGE_BASE_URL;
		expect(getStorageBaseUrl()).toBe("https://storage.googleapis.com");
	});

	it("returns custom URL from env", () => {
		process.env.FLUTTER_STORAGE_BASE_URL = "https://mirror.example.com";
		expect(getStorageBaseUrl()).toBe("https://mirror.example.com");
	});
});

describe("getManifestUrl", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns correct manifest URL for linux", () => {
		delete process.env.FLUTTER_STORAGE_BASE_URL;
		expect(getManifestUrl("linux")).toBe(
			"https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json",
		);
	});

	it("returns correct manifest URL for macos", () => {
		delete process.env.FLUTTER_STORAGE_BASE_URL;
		expect(getManifestUrl("macos")).toBe(
			"https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json",
		);
	});

	it("uses custom storage base URL", () => {
		process.env.FLUTTER_STORAGE_BASE_URL = "https://mirror.example.com";
		expect(getManifestUrl("linux")).toBe(
			"https://mirror.example.com/flutter_infra_release/releases/releases_linux.json",
		);
	});
});
