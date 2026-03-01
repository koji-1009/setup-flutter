import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import * as core from "@actions/core";
import * as httpClient from "@actions/http-client";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import type { ResolvedVersion } from "../src/version";

vi.mock("@actions/http-client");
vi.mock("@actions/tool-cache");
vi.mock("@actions/core");
vi.mock("@actions/io");

const mockedHttpClient = httpClient as Mocked<typeof httpClient>;
const mockedTc = tc as Mocked<typeof tc>;
const mockedCore = core as Mocked<typeof core>;
const mockedIo = io as Mocked<typeof io>;

// Create a known buffer and compute its SHA-256
const testBuffer = Buffer.from("test-flutter-archive");
const testSha256 = crypto.createHash("sha256").update(testBuffer).digest("hex");

const resolved: ResolvedVersion = {
	version: "3.29.0",
	channel: "stable",
	dartVersion: "3.7.0",
	downloadUrl:
		"https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.29.0-stable.tar.xz",
	hash: "abc123",
	sha256: testSha256,
	arch: "x64",
};

function mockHttpGetWith(statusCode?: number) {
	mockedHttpClient.HttpClient.mockImplementation(
		class {
			get = vi.fn().mockResolvedValue({
				message: Object.assign(Readable.from([testBuffer]), {
					statusCode,
				}),
			});
		} as unknown as typeof httpClient.HttpClient,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockHttpGetWith(200);
	mockedTc.extractTar.mockResolvedValue("/opt");
	mockedTc.extractZip.mockResolvedValue("/opt");
	mockedIo.mkdirP.mockResolvedValue();
	mockedIo.mv.mockResolvedValue();
	mockedIo.rmRF.mockResolvedValue();
});

// Import after mocks are set up
const { installFromArchive, setupPath } = await import("../src/installer");

describe("installFromArchive", () => {
	it("uses extractTar with xJ flags on linux", async () => {
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mockedTc.extractTar).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
			["xJ"],
		);
		expect(mockedTc.extractZip).not.toHaveBeenCalled();
	});

	it("uses extractZip on macos", async () => {
		await installFromArchive(resolved, "/opt/flutter", "macos");
		expect(mockedTc.extractZip).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
		);
		expect(mockedTc.extractTar).not.toHaveBeenCalled();
	});

	it("uses extractZip on windows", async () => {
		await installFromArchive(resolved, "/opt/flutter", "windows");
		expect(mockedTc.extractZip).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
		);
		expect(mockedTc.extractTar).not.toHaveBeenCalled();
	});

	it("succeeds when SHA-256 matches", async () => {
		const result = await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(result).toBe("/opt/flutter");
		expect(mockedIo.mv).toHaveBeenCalled();
	});

	it("throws and cleans up when SHA-256 mismatches", async () => {
		const badResolved = { ...resolved, sha256: "wrong-hash" };
		await expect(
			installFromArchive(badResolved, "/opt/flutter", "linux"),
		).rejects.toThrow("SHA-256 mismatch");
		expect(mockedIo.rmRF).toHaveBeenCalled();
	});

	it("throws when HTTP response has error status", async () => {
		mockHttpGetWith(404);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Download failed: HTTP 404");
	});

	it("throws when HTTP status code is undefined", async () => {
		mockHttpGetWith();
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Download failed: HTTP undefined");
	});

	it("moves flutter directory to sdkPath", async () => {
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mockedIo.mv).toHaveBeenCalledWith(
			expect.stringContaining("flutter"),
			"/opt/flutter",
		);
	});
});

describe("setupPath", () => {
	it("adds flutter bin and dart-sdk bin to PATH and sets FLUTTER_ROOT", () => {
		setupPath("/opt/flutter");
		expect(mockedCore.addPath).toHaveBeenCalledTimes(2);
		expect(mockedCore.addPath).toHaveBeenCalledWith("/opt/flutter/bin");
		expect(mockedCore.addPath).toHaveBeenCalledWith(
			"/opt/flutter/bin/cache/dart-sdk/bin",
		);
		expect(mockedCore.exportVariable).toHaveBeenCalledWith(
			"FLUTTER_ROOT",
			"/opt/flutter",
		);
	});
});
