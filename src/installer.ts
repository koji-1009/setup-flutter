import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { addPath, exportVariable, info, warning } from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { mkdirP, mv, rmRF } from "@actions/io";
import { extractTar, extractZip } from "@actions/tool-cache";
import type { ResolvedVersion } from "./version";

const MAX_DOWNLOAD_ATTEMPTS = 3;
const SOCKET_TIMEOUT_MS = 60_000;

function toMB(bytes: number): number {
	return bytes / (1024 * 1024);
}

function isRetryableError(error: Error): boolean {
	const match = error.message.match(/HTTP (\d+)/);
	if (match) {
		const status = Number(match[1]);
		return status >= 500 || status === 408 || status === 429;
	}
	return true;
}

async function downloadWithHash(
	url: string,
): Promise<{ file: string; sha256: string }> {
	const http = new HttpClient("setup-flutter", undefined, {
		socketTimeout: SOCKET_TIMEOUT_MS,
	});
	const response = await http.get(url);
	if (
		response.message.statusCode === undefined ||
		response.message.statusCode < 200 ||
		response.message.statusCode >= 300
	) {
		throw new Error(
			`Download failed: HTTP ${response.message.statusCode} for ${url}`,
		);
	}
	const tmpFile = join(tmpdir(), `flutter-${randomUUID()}.archive`);
	const hash = createHash("sha256");
	const fileStream = createWriteStream(tmpFile);
	const contentLength = Number(response.message.headers["content-length"] || 0);
	let downloaded = 0;
	let nextThreshold = 10;
	const startTime = Date.now();
	try {
		await pipeline(
			response.message,
			async function* (source) {
				for await (const chunk of source) {
					hash.update(chunk);
					downloaded += chunk.length;
					if (contentLength > 0) {
						const percent = (downloaded / contentLength) * 100;
						if (nextThreshold <= percent) {
							const elapsed = (Date.now() - startTime) / 1000;
							const speed = toMB(downloaded) / (elapsed || 1);
							while (nextThreshold <= percent) {
								info(
									`Download progress: ${nextThreshold}% (${toMB(downloaded).toFixed(1)} MB / ${toMB(contentLength).toFixed(1)} MB) ${elapsed.toFixed(1)}s ${speed.toFixed(1)} MB/s`,
								);
								nextThreshold += 10;
							}
						}
					} else {
						const mb = toMB(downloaded);
						const prevMb = toMB(downloaded - chunk.length);
						const step = 100;
						if (Math.floor(mb / step) > Math.floor(prevMb / step)) {
							const elapsed = (Date.now() - startTime) / 1000;
							const speed = toMB(downloaded) / (elapsed || 1);
							info(
								`Download progress: ${mb.toFixed(1)} MB downloaded ${elapsed.toFixed(1)}s ${speed.toFixed(1)} MB/s`,
							);
						}
					}
					yield chunk;
				}
			},
			fileStream,
		);
	} catch (error) {
		await rmRF(tmpFile).catch((e) =>
			warning(`Failed to clean up temp file: ${e}`),
		);
		throw error;
	}
	return { file: tmpFile, sha256: hash.digest("hex") };
}

async function downloadAndVerify(
	url: string,
	expectedSha256: string,
): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		let file: string | undefined;
		try {
			const result = await downloadWithHash(url);
			file = result.file;
			info("Verifying archive checksum...");
			if (result.sha256 !== expectedSha256) {
				throw new Error(
					`SHA-256 mismatch for ${url}: expected ${expectedSha256}, got ${result.sha256}`,
				);
			}
			return file;
		} catch (error) {
			if (file)
				await rmRF(file).catch((e) =>
					warning(`Failed to clean up temp file: ${e}`),
				);
			const err = error instanceof Error ? error : new Error(String(error));
			if (!isRetryableError(err) || attempt >= MAX_DOWNLOAD_ATTEMPTS) {
				throw err;
			}
			const delaySec = Math.floor(Math.random() * 11) + 10;
			info(
				`Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${err.message}. Retrying in ${delaySec}s...`,
			);
			await sleep(delaySec * 1000);
		}
	}
}

export async function installFromArchive(
	resolved: ResolvedVersion,
	sdkPath: string,
	platform: string,
): Promise<void> {
	info(`Downloading Flutter ${resolved.version}...`);
	const tmpFile = await downloadAndVerify(
		resolved.downloadUrl,
		resolved.sha256,
	);
	try {
		info("Extracting archive...");
		// Extract to the parent of sdkPath so the rename stays on the same
		// filesystem.  Without this, Windows runners fail with EXDEV because
		// the temp dir (D:\) and tool-cache (C:\) are on different drives.
		const extractParent = dirname(sdkPath);
		await mkdirP(extractParent);

		const extractDir =
			platform === "linux"
				? await extractTar(tmpFile, extractParent, ["xJ"])
				: await extractZip(tmpFile, extractParent);

		await mv(join(extractDir, "flutter"), sdkPath);
	} finally {
		await rmRF(tmpFile);
	}
}

export function setupPath(sdkPath: string): void {
	addPath(join(sdkPath, "bin"));
	addPath(join(sdkPath, "bin", "cache", "dart-sdk", "bin"));
	exportVariable("FLUTTER_ROOT", sdkPath);
}
