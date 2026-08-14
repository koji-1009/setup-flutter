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

// GITHUB_ACTION_PATH is only set for composite actions, so the bundle resolves
// the action root from its own location. The number of levels comes from the
// outfile, so it follows any change to the output layout.
function actionRootBanner(outfile) {
	const up = outfile
		.split("/")
		.slice(0, -1)
		.map(() => '".."')
		.join(", ");
	return {
		js: `globalThis.__actionRoot = require("node:path").join(__dirname, ${up});`,
	};
}

const setupOutfile = "dist/setup/index.js";

await Promise.all([
	build({
		...shared,
		entryPoints: ["src/main.ts"],
		outfile: setupOutfile,
		banner: actionRootBanner(setupOutfile),
	}),
	build({
		...shared,
		entryPoints: ["src/post.ts"],
		outfile: "dist/post/index.js",
	}),
]);
