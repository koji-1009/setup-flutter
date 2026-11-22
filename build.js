import { readFileSync } from "node:fs";
import { build } from "vite";

const actionYml = readFileSync("action.yml", "utf8");
const match = actionYml.match(/using:\s*(['"])node(\d+)\1/);
if (!match) {
	throw new Error("Could not find node version in action.yml");
}
const target = `node${match[2]}`;

async function bundle(input, outDir) {
	await build({
		// The runner executes dist/ without node_modules, so bundle every dependency.
		ssr: { noExternal: true },
		build: {
			ssr: input,
			target,
			outDir,
			rolldownOptions: {
				output: {
					entryFileNames: "index.js",
					// Keep license notices. JSDoc and #__PURE__ annotations only serve
					// editors and downstream bundlers, and nothing re-bundles dist/.
					comments: { legal: true, annotation: false, jsdoc: false },
				},
			},
		},
	});
}

await bundle("src/main.ts", "dist/setup");
await bundle("src/post.ts", "dist/post");
