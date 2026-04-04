import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { addPath, exportVariable, info, warning } from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { mkdirP, mv, rmRF } from "@actions/io";
import { extractTar, extractZip } from "@actions/tool-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedVersion } from "../src/version";

vi.mock("@actions/http-client");
vi.mock("@actions/tool-cache");
vi.mock("@actions/core");
vi.mock("@actions/io");
vi.mock("node:timers/promises", () => ({
	setTimeout: vi.fn().mockResolvedValue(undefined),
}));

// Create a known buffer and compute its SHA-256
const testBuffer = Buffer.from("test-flutter-archive");
const testSha256 = createHash("sha256").update(testBuffer).digest("hex");

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

function mockHttpGetWith(
	statusCode?: number,
	contentLength?: string,
	chunks?: Buffer[],
) {
	vi.mocked(HttpClient).mockImplementation(
		class {
			get = vi.fn().mockResolvedValue({
				message: Object.assign(Readable.from(chunks ?? [testBuffer]), {
					statusCode,
					headers: contentLength ? { "content-length": contentLength } : {},
				}),
			});
		} as unknown as typeof HttpClient,
	);
}

function mockHttpGetSequence(
	...responses: Array<{
		statusCode?: number;
		contentLength?: string;
		chunks?: Buffer[];
	}>
) {
	let idx = 0;
	vi.mocked(HttpClient).mockImplementation(
		class {
			get = (() => {
				const config = responses[Math.min(idx++, responses.length - 1)];
				return vi.fn().mockResolvedValue({
					message: Object.assign(Readable.from(config.chunks ?? [testBuffer]), {
						statusCode: config.statusCode,
						headers: config.contentLength
							? { "content-length": config.contentLength }
							: {},
					}),
				});
			})();
		} as unknown as typeof HttpClient,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockHttpGetWith(200, String(testBuffer.length));
	vi.mocked(extractTar).mockResolvedValue("/opt");
	vi.mocked(extractZip).mockResolvedValue("/opt");
	vi.mocked(mkdirP).mockResolvedValue();
	vi.mocked(mv).mockResolvedValue();
	vi.mocked(rmRF).mockResolvedValue();
});

// Import after mocks are set up
const { installFromArchive, setupPath } = await import("../src/installer");

describe("installFromArchive", () => {
	it("uses extractTar with xJ flags on linux", async () => {
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(extractTar).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
			["xJ"],
		);
		expect(extractZip).not.toHaveBeenCalled();
	});

	it("uses extractZip on macos", async () => {
		await installFromArchive(resolved, "/opt/flutter", "macos");
		expect(extractZip).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
		);
		expect(extractTar).not.toHaveBeenCalled();
	});

	it("uses extractZip on windows", async () => {
		await installFromArchive(resolved, "/opt/flutter", "windows");
		expect(extractZip).toHaveBeenCalledWith(
			expect.stringContaining(".archive"),
			"/opt",
		);
		expect(extractTar).not.toHaveBeenCalled();
	});

	it("succeeds when SHA-256 matches", async () => {
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mv).toHaveBeenCalled();
	});

	it("throws and cleans up when SHA-256 mismatches", async () => {
		const badResolved = { ...resolved, sha256: "wrong-hash" };
		await expect(
			installFromArchive(badResolved, "/opt/flutter", "linux"),
		).rejects.toThrow(`SHA-256 mismatch for ${resolved.downloadUrl}`);
		expect(rmRF).toHaveBeenCalled();
	});

	it("throws when HTTP response has error status", async () => {
		mockHttpGetWith(404);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow(`Download failed: HTTP 404 for ${resolved.downloadUrl}`);
	});

	it("throws when HTTP status code is undefined", async () => {
		mockHttpGetWith();
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow(
			`Download failed: HTTP undefined for ${resolved.downloadUrl}`,
		);
	});

	it("logs percentage progress when content-length is available", async () => {
		// Create 10 equal chunks so each is 10% of total
		const chunkSize = 64;
		const totalSize = chunkSize * 10;
		const chunks = Array.from({ length: 10 }, () =>
			Buffer.alloc(chunkSize, "a"),
		);
		const sha = createHash("sha256")
			.update(Buffer.concat(chunks))
			.digest("hex");
		mockHttpGetWith(200, String(totalSize), chunks);
		const r = { ...resolved, sha256: sha };
		await installFromArchive(r, "/opt/flutter", "linux");

		const progressCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Download progress:"));
		expect(progressCalls).toHaveLength(10);
		expect(progressCalls[0][0]).toContain("10%");
		expect(progressCalls[4][0]).toContain("50%");
		expect(progressCalls[9][0]).toContain("100%");
		expect(progressCalls[0][0]).toMatch(/\d+\.\d+s/);
		expect(progressCalls[0][0]).toMatch(/\d+\.\d+ MB\/s/);
	});

	it("skips progress log when threshold is not reached", async () => {
		// 20 small chunks, each 5% of total — only even thresholds (10%, 20%, …) log
		const chunkSize = 32;
		const totalSize = chunkSize * 20;
		const chunks = Array.from({ length: 20 }, () =>
			Buffer.alloc(chunkSize, "a"),
		);
		const sha = createHash("sha256")
			.update(Buffer.concat(chunks))
			.digest("hex");
		mockHttpGetWith(200, String(totalSize), chunks);
		const r = { ...resolved, sha256: sha };
		await installFromArchive(r, "/opt/flutter", "linux");

		const progressCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Download progress:"));
		// 10%, 20%, ..., 100% = 10 log lines (5% chunks don't trigger logs)
		expect(progressCalls).toHaveLength(10);
		expect(progressCalls[0][0]).toContain("10%");
		expect(progressCalls[0][0]).not.toContain("5%");
	});

	it("logs MB progress when content-length is missing", async () => {
		// First chunk (50 MB) does NOT cross a 100 MB boundary → false branch
		// Second chunk (60 MB) crosses the 100 MB boundary → true branch
		const smallChunk = Buffer.alloc(50 * 1024 * 1024, "a");
		const bigChunk = Buffer.alloc(60 * 1024 * 1024, "b");
		const sha = createHash("sha256")
			.update(smallChunk)
			.update(bigChunk)
			.digest("hex");
		mockHttpGetWith(200, undefined, [smallChunk, bigChunk]);
		const r = { ...resolved, sha256: sha };
		await installFromArchive(r, "/opt/flutter", "linux");

		const progressCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("MB downloaded"));
		expect(progressCalls).toHaveLength(1);
		expect(progressCalls[0][0]).toMatch(/\d+\.\d+s/);
		expect(progressCalls[0][0]).toMatch(/\d+\.\d+ MB\/s/);
	});

	it("uses fallback speed when elapsed is zero", async () => {
		const now = Date.now();
		const spy = vi.spyOn(Date, "now").mockReturnValue(now);
		// content-length missing, single large chunk crossing 100 MB boundary
		const chunk = Buffer.alloc(101 * 1024 * 1024, "a");
		const sha = createHash("sha256").update(chunk).digest("hex");
		mockHttpGetWith(200, undefined, [chunk]);
		const r = { ...resolved, sha256: sha };
		await installFromArchive(r, "/opt/flutter", "linux");

		const progressCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("MB downloaded"));
		expect(progressCalls).toHaveLength(1);
		expect(progressCalls[0][0]).toContain("MB/s");
		spy.mockRestore();
	});

	it("moves flutter directory to sdkPath", async () => {
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mv).toHaveBeenCalledWith(
			expect.stringContaining("flutter"),
			"/opt/flutter",
		);
	});
});

describe("download retry", () => {
	it("retries on HTTP 500 and succeeds on next attempt", async () => {
		mockHttpGetSequence(
			{ statusCode: 500 },
			{ statusCode: 200, contentLength: String(testBuffer.length) },
		);
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mv).toHaveBeenCalled();
		const retryCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Retrying in"));
		expect(retryCalls).toHaveLength(1);
	});

	it("retries on HTTP 429 and succeeds on next attempt", async () => {
		mockHttpGetSequence(
			{ statusCode: 429 },
			{ statusCode: 200, contentLength: String(testBuffer.length) },
		);
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mv).toHaveBeenCalled();
	});

	it("does not retry on HTTP 404", async () => {
		mockHttpGetWith(404);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Download failed: HTTP 404");
		const retryCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Retrying in"));
		expect(retryCalls).toHaveLength(0);
	});

	it("does not retry on HTTP 403", async () => {
		mockHttpGetWith(403);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Download failed: HTTP 403");
		const retryCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Retrying in"));
		expect(retryCalls).toHaveLength(0);
	});

	it("throws after exhausting all retry attempts", async () => {
		mockHttpGetWith(500);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Download failed: HTTP 500");
		const retryCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Retrying in"));
		expect(retryCalls).toHaveLength(2);
	});

	it("cleans up temp file when stream fails mid-download", async () => {
		vi.mocked(HttpClient).mockImplementation(
			class {
				get = vi.fn().mockImplementation(async () => {
					async function* failing() {
						yield Buffer.from("partial-data");
						throw new Error("Connection reset");
					}
					return {
						message: Object.assign(Readable.from(failing()), {
							statusCode: 200,
							headers: { "content-length": "1000" },
						}),
					};
				});
			} as unknown as typeof HttpClient,
		);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Connection reset");
		expect(rmRF).toHaveBeenCalled();
	});

	it("warns when temp file cleanup fails on stream error", async () => {
		vi.mocked(rmRF).mockRejectedValue(new Error("EPERM"));
		vi.mocked(HttpClient).mockImplementation(
			class {
				get = vi.fn().mockImplementation(async () => {
					async function* failing() {
						yield Buffer.from("partial-data");
						throw new Error("Connection reset");
					}
					return {
						message: Object.assign(Readable.from(failing()), {
							statusCode: 200,
							headers: { "content-length": "1000" },
						}),
					};
				});
			} as unknown as typeof HttpClient,
		);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("Connection reset");
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Failed to clean up temp file"),
		);
	});

	it("warns when temp file cleanup fails on SHA-256 mismatch", async () => {
		vi.mocked(rmRF).mockRejectedValue(new Error("EPERM"));
		const badResolved = { ...resolved, sha256: "wrong-hash" };
		await expect(
			installFromArchive(badResolved, "/opt/flutter", "linux"),
		).rejects.toThrow("SHA-256 mismatch");
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Failed to clean up temp file"),
		);
	});

	it("wraps non-Error thrown value into Error", async () => {
		vi.mocked(HttpClient).mockImplementation(
			class {
				get = vi.fn().mockRejectedValue("string error");
			} as unknown as typeof HttpClient,
		);
		await expect(
			installFromArchive(resolved, "/opt/flutter", "linux"),
		).rejects.toThrow("string error");
	});

	it("retries on SHA-256 mismatch and succeeds on next attempt", async () => {
		const badBuffer = Buffer.from("corrupted-data");
		mockHttpGetSequence(
			{
				statusCode: 200,
				contentLength: String(badBuffer.length),
				chunks: [badBuffer],
			},
			{ statusCode: 200, contentLength: String(testBuffer.length) },
		);
		await installFromArchive(resolved, "/opt/flutter", "linux");
		expect(mv).toHaveBeenCalled();
		const retryCalls = vi
			.mocked(info)
			.mock.calls.filter((c) => String(c[0]).includes("Retrying in"));
		expect(retryCalls).toHaveLength(1);
	});
});

describe("setupPath", () => {
	it("adds flutter bin and dart-sdk bin to PATH and sets FLUTTER_ROOT", () => {
		setupPath("/opt/flutter");
		expect(addPath).toHaveBeenCalledTimes(2);
		expect(addPath).toHaveBeenCalledWith("/opt/flutter/bin");
		expect(addPath).toHaveBeenCalledWith("/opt/flutter/bin/cache/dart-sdk/bin");
		expect(exportVariable).toHaveBeenCalledWith("FLUTTER_ROOT", "/opt/flutter");
	});
});
