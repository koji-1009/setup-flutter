import { readFileSync } from "node:fs";
import { build } from "vite";

const actionYml = readFileSync("action.yml", "utf8");
const match = actionYml.match(/using:\s*(['"])node(\d+)\1/);
if (!match) {
	throw new Error("Could not find node version in action.yml");
}
const target = `node${match[2]}`;

// Bundled through vite (already installed for vitest) so that the rolldown
// version is always the one vite pins, instead of a second copy of our own.
async function bundle(input, outDir) {
	await build({
		configFile: false,
		logLevel: "warn",
		// Bundle every dependency: the runner executes dist/ without node_modules.
		ssr: { noExternal: true, target: "node" },
		build: {
			ssr: input,
			target,
			outDir,
			emptyOutDir: false,
			copyPublicDir: false,
			minify: false,
			rolldownOptions: {
				output: {
					format: "cjs",
					entryFileNames: "index.js",
					// GitHub Actions runs one file per entry point, so nothing may be split out.
					codeSplitting: false,
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
