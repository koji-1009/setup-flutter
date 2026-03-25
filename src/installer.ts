import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { addPath, exportVariable, info } from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { mkdirP, mv, rmRF } from "@actions/io";
import { extractTar, extractZip } from "@actions/tool-cache";
import type { ResolvedVersion } from "./version";

function toMB(bytes: number): number {
	return bytes / (1024 * 1024);
}

async function downloadWithHash(
	url: string,
): Promise<{ file: string; sha256: string }> {
	const http = new HttpClient("setup-flutter");
	const response = await http.get(url);
	if (
		response.message.statusCode === undefined ||
		response.message.statusCode < 200 ||
		response.message.statusCode >= 300
	) {
		throw new Error(`Download failed: HTTP ${response.message.statusCode}`);
	}
	const tmpFile = join(tmpdir(), `flutter-${randomUUID()}.archive`);
	const hash = createHash("sha256");
	const fileStream = createWriteStream(tmpFile);
	const contentLength = Number(response.message.headers["content-length"] || 0);
	let downloaded = 0;
	let nextThreshold = 10;
	const startTime = Date.now();
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
	return { file: tmpFile, sha256: hash.digest("hex") };
}

export async function installFromArchive(
	resolved: ResolvedVersion,
	sdkPath: string,
	platform: string,
): Promise<void> {
	info(`Downloading Flutter ${resolved.version}...`);
	const { file: tmpFile, sha256: actual } = await downloadWithHash(
		resolved.downloadUrl,
	);
	try {
		info("Verifying archive checksum...");
		if (actual !== resolved.sha256) {
			throw new Error(
				`SHA-256 mismatch: expected ${resolved.sha256}, got ${actual}`,
			);
		}

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
