import * as fs from "node:fs";
import * as path from "node:path";

export async function readVersionFile(
	filePath: string,
	flavor?: string,
): Promise<string> {
	const basename = path.basename(filePath);
	if (basename === "pubspec.yaml" || basename === "pubspec.yml") {
		return readPubspec(filePath);
	}
	if (basename === ".fvmrc") {
		return readFvmrc(filePath, flavor);
	}
	throw new Error(`Unsupported version file: ${basename}`);
}

export function readPubspec(filePath: string): string {
	const content = fs.readFileSync(filePath, "utf8");
	const lines = content.split("\n");
	let inEnvironment = false;
	for (const line of lines) {
		if (/^environment\s*:/.test(line)) {
			inEnvironment = true;
			continue;
		}
		if (inEnvironment) {
			if (/^\S/.test(line) && line.trim() !== "") {
				break;
			}
			const m = line.match(/^\s+flutter\s*:\s*(.+)/);
			if (m) {
				return m[1].replace(/^["']|["']$/g, "").trim();
			}
		}
	}
	throw new Error("pubspec.yaml does not contain environment.flutter");
}

export function readFvmrc(filePath: string, flavor?: string): string {
	const content = fs.readFileSync(filePath, "utf8");
	const json = JSON.parse(content);
	if (flavor) {
		const flavorVersion = json.flavors?.[flavor];
		if (!flavorVersion) {
			throw new Error(`FVM flavor '${flavor}' not found in ${filePath}`);
		}
		return flavorVersion;
	}
	if (!json.flutter) {
		throw new Error(`flutter field not found in ${filePath}`);
	}
	return json.flutter;
}
