import { readFileSync } from "node:fs";
import { build } from "esbuild";

const actionYml = readFileSync("action.yml", "utf8");
const match = actionYml.match(/using:\s*'node(\d+)'/);
if (!match) {
	throw new Error("Could not find node version in action.yml");
}
const target = `node${match[1]}`;

const shared = {
	bundle: true,
	platform: "node",
	target,
	format: "cjs",
};

await Promise.all([
	build({
		...shared,
		entryPoints: ["src/main.ts"],
		outfile: "dist/setup/index.js",
	}),
	build({
		...shared,
		entryPoints: ["src/post.ts"],
		outfile: "dist/post/index.js",
	}),
]);
