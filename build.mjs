import { readFileSync } from "node:fs";
import { rolldown } from "rolldown";

const actionYml = readFileSync("action.yml", "utf8");
const match = actionYml.match(/using:\s*(['"])node(\d+)\1/);
if (!match) {
	throw new Error("Could not find node version in action.yml");
}
const target = `node${match[2]}`;

async function bundle(input, file) {
	const build = await rolldown({
		input,
		platform: "node",
		transform: { target },
	});
	try {
		await build.write({
			file,
			format: "cjs",
			// GitHub Actions runs one file per entry point, so nothing may be split out.
			codeSplitting: false,
			// Keep license notices. JSDoc and #__PURE__ annotations only serve
			// editors and downstream bundlers, and nothing re-bundles dist/.
			comments: { legal: true, annotation: false, jsdoc: false },
		});
	} finally {
		await build.close();
	}
}

await Promise.all([
	bundle("src/main.ts", "dist/setup/index.js"),
	bundle("src/post.ts", "dist/post/index.js"),
]);
