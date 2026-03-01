import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import type { ResolvedVersion } from "./version";

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
	const tmpFile = path.join(
		os.tmpdir(),
		`flutter-${crypto.randomUUID()}.archive`,
	);
	const hash = crypto.createHash("sha256");
	const fileStream = fs.createWriteStream(tmpFile);
	await pipeline(
		response.message,
		async function* (source) {
			for await (const chunk of source) {
				hash.update(chunk);
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
): Promise<string> {
	core.info(`Downloading Flutter ${resolved.version}...`);
	const { file: tmpFile, sha256: actual } = await downloadWithHash(
		resolved.downloadUrl,
	);
	try {
		if (actual !== resolved.sha256) {
			throw new Error(
				`SHA-256 mismatch: expected ${resolved.sha256}, got ${actual}`,
			);
		}

		// Extract to the parent of sdkPath so the rename stays on the same
		// filesystem.  Without this, Windows runners fail with EXDEV because
		// the temp dir (D:\) and tool-cache (C:\) are on different drives.
		const extractParent = path.dirname(sdkPath);
		await io.mkdirP(extractParent);

		const extractDir =
			platform === "linux"
				? await tc.extractTar(tmpFile, extractParent, ["xJ"])
				: await tc.extractZip(tmpFile, extractParent);

		await io.mv(path.join(extractDir, "flutter"), sdkPath);
	} finally {
		await io.rmRF(tmpFile);
	}
	return sdkPath;
}

export function setupPath(sdkPath: string): void {
	core.addPath(path.join(sdkPath, "bin"));
	core.addPath(path.join(sdkPath, "bin", "cache", "dart-sdk", "bin"));
	core.exportVariable("FLUTTER_ROOT", sdkPath);
}
