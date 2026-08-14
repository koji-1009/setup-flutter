import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { info, warning } from "@actions/core";

/** Problem matcher definition committed at the action root. */
const MATCHER_FILE = "flutter-analyzer.json";

/**
 * Registers the analyzer problem matcher so that `flutter analyze` and
 * `dart analyze` diagnostics in later steps become inline annotations.
 *
 * `GITHUB_ACTION_PATH` is only set for composite actions, so the definition is
 * located by walking up from this file: one level from `src`, two from the
 * bundle in `dist/setup`. The runner reads the file itself, so only the path is
 * emitted.
 */
export function registerProblemMatcher(): void {
	let dir = __dirname;
	for (;;) {
		const candidate = join(dir, MATCHER_FILE);
		if (existsSync(candidate)) {
			info(`::add-matcher::${candidate}`);
			return;
		}

		const parent = dirname(dir);
		if (parent === dir) {
			warning(
				`Could not locate ${MATCHER_FILE}; skipping problem matcher registration`,
			);
			return;
		}
		dir = parent;
	}
}
