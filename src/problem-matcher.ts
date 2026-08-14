import { join } from "node:path";
import { info, warning } from "@actions/core";

/** Problem matcher definition committed at the action root. */
const MATCHER_FILE = "flutter-analyzer.json";

/**
 * Registers the analyzer problem matcher so that `flutter analyze` and
 * `dart analyze` diagnostics in later steps become inline annotations.
 *
 * `GITHUB_ACTION_PATH` is only set for composite actions, so the action root is
 * injected into the bundle by `build.mjs`, resolved from the bundle's own
 * location. The runner reads the definition file itself, so only the path is
 * emitted.
 */
export function registerProblemMatcher(): void {
	const actionRoot = (globalThis as { __actionRoot?: string }).__actionRoot;
	if (!actionRoot) {
		warning(
			"Could not resolve the action root; skipping problem matcher registration",
		);
		return;
	}

	info(`::add-matcher::${join(actionRoot, MATCHER_FILE)}`);
}
