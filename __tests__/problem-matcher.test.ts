import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { info, warning } from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerProblemMatcher } from "../src/problem-matcher";

vi.mock("@actions/core");

// Only existsSync is faked, so the definition below is read from disk and the
// lookup walks the real tree unless a test says otherwise.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: vi.fn() };
});

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

type MatcherPattern = {
	regexp: string;
	severity: number;
	file: number;
	line: number;
	column: number;
	message: number;
	code: number;
};

const definition: {
	problemMatcher: { owner: string; pattern: MatcherPattern[] }[];
} = JSON.parse(
	readFileSync(join(__dirname, "../flutter-analyzer.json"), "utf8"),
);

function patternFor(owner: string): MatcherPattern {
	const matcher = definition.problemMatcher.find((m) => m.owner === owner);
	if (!matcher) {
		throw new Error(`No matcher for owner '${owner}'`);
	}
	return matcher.pattern[0];
}

/** Matches a line and returns the fields the runner would annotate with. */
function apply(owner: string, line: string) {
	const pattern = patternFor(owner);
	const match = new RegExp(pattern.regexp).exec(line);
	if (!match) {
		return undefined;
	}
	return {
		severity: match[pattern.severity],
		file: match[pattern.file],
		line: match[pattern.line],
		column: match[pattern.column],
		message: match[pattern.message],
		code: match[pattern.code],
	};
}

// Captured from `flutter analyze` (severity, message, location, code) and
// `dart analyze` (severity, location, message, code) — the field order differs.
const FLUTTER_BULLET =
	"warning • The value of the local variable 'x' isn't used. Try removing the variable or using it • lib/main.dart:4:7 • unused_local_variable";
const FLUTTER_DASH =
	"warning - The value of the local variable 'x' isn't used. Try removing the variable or using it - lib\\main.dart:4:7 - unused_local_variable";
const DART_BULLET =
	"  error • lib/main.dart:5:3 • The function 'undefinedFunction' isn't defined. • undefined_function";
const DART_DASH =
	"  error - lib/main.dart:5:3 - The function 'undefinedFunction' isn't defined. - undefined_function";

describe("flutter-analyzer.json", () => {
	it("parses flutter analyze bullet output", () => {
		expect(apply("flutter-analyze-bullet", FLUTTER_BULLET)).toEqual({
			severity: "warning",
			message:
				"The value of the local variable 'x' isn't used. Try removing the variable or using it",
			file: "lib/main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		});
	});

	it("parses flutter analyze dash output on Windows", () => {
		expect(apply("flutter-analyze-dash", FLUTTER_DASH)).toEqual({
			severity: "warning",
			message:
				"The value of the local variable 'x' isn't used. Try removing the variable or using it",
			file: "lib\\main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		});
	});

	it("parses dart analyze bullet output", () => {
		expect(apply("dart-analyze-bullet", DART_BULLET)).toEqual({
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		});
	});

	it("parses dart analyze dash output", () => {
		expect(apply("dart-analyze-dash", DART_DASH)).toEqual({
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		});
	});

	it("keeps info severity and leading padding", () => {
		expect(
			apply(
				"flutter-analyze-bullet",
				"   info • Unused import: 'dart:async' • lib/main.dart:1:8 • unused_import",
			),
		).toEqual({
			severity: "info",
			message: "Unused import: 'dart:async'",
			file: "lib/main.dart",
			line: "1",
			column: "8",
			code: "unused_import",
		});
	});

	it("keeps an absolute Windows path intact", () => {
		expect(
			apply(
				"flutter-analyze-dash",
				"  error - Broken - C:\\a\\lib\\main.dart:12:3 - undefined_function",
			)?.file,
		).toBe("C:\\a\\lib\\main.dart");
	});

	// The two field orders are mutually exclusive, so a line is annotated once.
	it("does not cross-match between flutter and dart layouts", () => {
		expect(apply("dart-analyze-bullet", FLUTTER_BULLET)).toBeUndefined();
		expect(apply("dart-analyze-dash", FLUTTER_DASH)).toBeUndefined();
		expect(apply("flutter-analyze-bullet", DART_BULLET)).toBeUndefined();
		expect(apply("flutter-analyze-dash", DART_DASH)).toBeUndefined();
	});

	it("ignores summary and progress lines", () => {
		for (const owner of definition.problemMatcher.map((m) => m.owner)) {
			expect(apply(owner, "Analyzing anlz...")).toBeUndefined();
			expect(apply(owner, "2 issues found. (ran in 0.3s)")).toBeUndefined();
			expect(apply(owner, "No issues found!")).toBeUndefined();
		}
	});

	it("ignores a hyphen inside a message without surrounding spaces", () => {
		expect(
			apply(
				"flutter-analyze-dash",
				"  error - The parameter is non-nullable - lib\\main.dart:3:1 - missing_required_argument",
			),
		).toEqual({
			severity: "error",
			message: "The parameter is non-nullable",
			file: "lib\\main.dart",
			line: "3",
			column: "1",
			code: "missing_required_argument",
		});
	});
});

describe("registerProblemMatcher()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(existsSync).mockImplementation(realFs.existsSync);
	});

	// GITHUB_ACTION_PATH is not set for a JavaScript action, so the definition is
	// found by walking up from the module: one level from src here, two from the
	// bundle in dist/setup on a runner.
	it("emits add-matcher with the definition found above the module", () => {
		registerProblemMatcher();

		expect(info).toHaveBeenCalledWith(
			`::add-matcher::${join(__dirname, "..", "flutter-analyzer.json")}`,
		);
		expect(warning).not.toHaveBeenCalled();
	});

	it("warns and skips when the definition is nowhere above the module", () => {
		vi.mocked(existsSync).mockReturnValue(false);

		registerProblemMatcher();

		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Could not locate flutter-analyzer.json"),
		);
		expect(info).not.toHaveBeenCalled();
	});
});
