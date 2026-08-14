import { join } from "node:path";
import { info, warning } from "@actions/core";

/** Problem matcher definition committed at the action root. */
const MATCHER_FILE = "flutter-analyzer.json";

/**
 * Registers the analyzer problem matcher so that `flutter analyze` and
 * `dart analyze` diagnostics in later steps become inline annotations.
 *
 * The runner reads the definition file itself, so only the path is emitted.
 */
export function registerProblemMatcher(): void {
	const actionPath = process.env.GITHUB_ACTION_PATH;
	if (!actionPath) {
		warning(
			"GITHUB_ACTION_PATH is not set; skipping problem matcher registration",
		);
		return;
	}

	info(`::add-matcher::${join(actionPath, MATCHER_FILE)}`);
}
