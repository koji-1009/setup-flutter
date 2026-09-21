import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	getArch,
	getManifestUrl,
	getPlatform,
	getPubCachePath,
	getStorageBaseUrl,
} from "../src/utils";

function stubPlatform(platform: string) {
	vi.spyOn(process, "platform", "get").mockReturnValue(
		platform as NodeJS.Platform,
	);
}

function stubArch(arch: string) {
	vi.spyOn(process, "arch", "get").mockReturnValue(arch as NodeJS.Architecture);
}

describe("getPlatform", () => {
	it.each([
		{ platform: "linux", expected: "linux" },
		{ platform: "darwin", expected: "macos" },
		{ platform: "win32", expected: "windows" },
	])("returns $expected for $platform", ({ platform, expected }) => {
		stubPlatform(platform);
		expect(getPlatform()).toBe(expected);
	});

	it("throws for unsupported platform", () => {
		stubPlatform("freebsd");
		expect(() => getPlatform()).toThrow("Unsupported platform: freebsd");
	});
});

describe("getArch", () => {
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
		stubArch("x64");
		expect(getArch()).toBe("x64");
	});

	it("returns arm64 from process.arch", () => {
		stubArch("arm64");
		expect(getArch()).toBe("arm64");
	});

	it("throws for unsupported process.arch", () => {
		stubArch("ia32");
		expect(() => getArch()).toThrow("Unsupported architecture: ia32");
	});
});

describe("getPubCachePath", () => {
	it("returns PUB_CACHE env var if set", () => {
		vi.stubEnv("PUB_CACHE", "/custom/pub-cache");
		expect(getPubCachePath()).toBe("/custom/pub-cache");
	});

	it("returns ~/.pub-cache on linux", () => {
		vi.stubEnv("PUB_CACHE", undefined);
		stubPlatform("linux");
		const expected = join(homedir(), ".pub-cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("returns ~/.pub-cache on macos", () => {
		vi.stubEnv("PUB_CACHE", undefined);
		stubPlatform("darwin");
		const expected = join(homedir(), ".pub-cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("returns LOCALAPPDATA/Pub/Cache on windows", () => {
		vi.stubEnv("PUB_CACHE", undefined);
		stubPlatform("win32");
		vi.stubEnv("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local");
		const expected = join("C:\\Users\\test\\AppData\\Local", "Pub", "Cache");
		expect(getPubCachePath()).toBe(expected);
	});

	it("throws when LOCALAPPDATA is unset on windows", () => {
		vi.stubEnv("PUB_CACHE", undefined);
		vi.stubEnv("LOCALAPPDATA", undefined);
		stubPlatform("win32");
		expect(() => getPubCachePath()).toThrow(
			"LOCALAPPDATA environment variable is not set",
		);
	});
});

describe("getStorageBaseUrl", () => {
	it("returns default URL", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", undefined);
		expect(getStorageBaseUrl()).toBe("https://storage.googleapis.com");
	});

	it("returns custom URL from env", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", "https://mirror.example.com");
		expect(getStorageBaseUrl()).toBe("https://mirror.example.com");
	});

	it("strips a trailing slash from the custom URL", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", "https://mirror.example.com/");
		expect(getStorageBaseUrl()).toBe("https://mirror.example.com");
	});
});

describe("getManifestUrl", () => {
	it("returns correct manifest URL for linux", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", undefined);
		expect(getManifestUrl("linux")).toBe(
			"https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json",
		);
	});

	it("returns correct manifest URL for macos", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", undefined);
		expect(getManifestUrl("macos")).toBe(
			"https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json",
		);
	});

	it("uses custom storage base URL", () => {
		vi.stubEnv("FLUTTER_STORAGE_BASE_URL", "https://mirror.example.com");
		expect(getManifestUrl("linux")).toBe(
			"https://mirror.example.com/flutter_infra_release/releases/releases_linux.json",
		);
	});
});
