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
	file: number;
	line: number;
	column: number;
	message: number;
	code: number;
};

type Matcher = {
	owner: string;
	severity: string;
	pattern: MatcherPattern[];
};

const definition: { problemMatcher: Matcher[] } = JSON.parse(
	readFileSync(join(__dirname, "../flutter-analyzer.json"), "utf8"),
);

function matcherFor(owner: string): Matcher {
	const matcher = definition.problemMatcher.find((m) => m.owner === owner);
	if (!matcher) {
		throw new Error(`No matcher for owner '${owner}'`);
	}
	return matcher;
}

/** Matches a line and returns the fields the runner would annotate with. */
function apply(owner: string, line: string) {
	const matcher = matcherFor(owner);
	const pattern = matcher.pattern[0];
	const match = new RegExp(pattern.regexp).exec(line);
	if (!match) {
		return undefined;
	}
	return {
		// No pattern captures a severity, so the runner takes the one declared on
		// the matcher.
		severity: matcher.severity,
		file: match[pattern.file],
		line: match[pattern.line],
		column: match[pattern.column],
		message: match[pattern.message],
		code: match[pattern.code],
	};
}

function ownersMatching(line: string): string[] {
	return definition.problemMatcher
		.filter((m) => new RegExp(m.pattern[0].regexp).test(line))
		.map((m) => m.owner);
}

// The analyzer reports three levels and GitHub accepts three, but it spells the
// mildest one "notice" and drops anything it does not know.
const SEVERITY_OF = { error: "error", warning: "warning", info: "notice" };

// Captured from `flutter analyze` (severity, message, location, code) and
// `dart analyze` (severity, location, message, code) — the field order differs.
// The separator is a bullet, except on Windows for flutter analyze and whenever
// dart analyze writes somewhere that is not a terminal. Severities are padded to
// the width of "warning".
const CASES = [
	{
		owner: "flutter-analyze-error-bullet",
		line: "  error • The function 'undefinedFunction' isn't defined. • lib/main.dart:5:3 • undefined_function",
		fields: {
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		},
	},
	{
		owner: "flutter-analyze-error-dash",
		line: "  error - The function 'undefinedFunction' isn't defined. - lib/main.dart:5:3 - undefined_function",
		fields: {
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		},
	},
	{
		owner: "flutter-analyze-warning-bullet",
		line: "warning • The value of the local variable 'x' isn't used. • lib/main.dart:4:7 • unused_local_variable",
		fields: {
			severity: "warning",
			message: "The value of the local variable 'x' isn't used.",
			file: "lib/main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		},
	},
	{
		owner: "flutter-analyze-warning-dash",
		line: "warning - The value of the local variable 'x' isn't used. - lib\\main.dart:4:7 - unused_local_variable",
		fields: {
			severity: "warning",
			message: "The value of the local variable 'x' isn't used.",
			file: "lib\\main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		},
	},
	{
		owner: "flutter-analyze-info-bullet",
		line: "   info • Unnecessary use of double quotes. • lib/main.dart:3:19 • prefer_single_quotes",
		fields: {
			severity: "notice",
			message: "Unnecessary use of double quotes.",
			file: "lib/main.dart",
			line: "3",
			column: "19",
			code: "prefer_single_quotes",
		},
	},
	{
		owner: "flutter-analyze-info-dash",
		line: "   info - Unnecessary use of double quotes. - lib/main.dart:3:19 - prefer_single_quotes",
		fields: {
			severity: "notice",
			message: "Unnecessary use of double quotes.",
			file: "lib/main.dart",
			line: "3",
			column: "19",
			code: "prefer_single_quotes",
		},
	},
	{
		owner: "dart-analyze-error-bullet",
		line: "  error • lib/main.dart:5:3 • The function 'undefinedFunction' isn't defined. • undefined_function",
		fields: {
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		},
	},
	{
		owner: "dart-analyze-error-dash",
		line: "  error - lib/main.dart:5:3 - The function 'undefinedFunction' isn't defined. - undefined_function",
		fields: {
			severity: "error",
			message: "The function 'undefinedFunction' isn't defined.",
			file: "lib/main.dart",
			line: "5",
			column: "3",
			code: "undefined_function",
		},
	},
	{
		owner: "dart-analyze-warning-bullet",
		line: "warning • lib/main.dart:4:7 • The value of the local variable 'x' isn't used. • unused_local_variable",
		fields: {
			severity: "warning",
			message: "The value of the local variable 'x' isn't used.",
			file: "lib/main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		},
	},
	{
		owner: "dart-analyze-warning-dash",
		line: "warning - lib/main.dart:4:7 - The value of the local variable 'x' isn't used. - unused_local_variable",
		fields: {
			severity: "warning",
			message: "The value of the local variable 'x' isn't used.",
			file: "lib/main.dart",
			line: "4",
			column: "7",
			code: "unused_local_variable",
		},
	},
	{
		owner: "dart-analyze-info-bullet",
		line: "   info • lib/main.dart:3:19 • Unnecessary use of double quotes. • prefer_single_quotes",
		fields: {
			severity: "notice",
			message: "Unnecessary use of double quotes.",
			file: "lib/main.dart",
			line: "3",
			column: "19",
			code: "prefer_single_quotes",
		},
	},
	{
		owner: "dart-analyze-info-dash",
		line: "   info - lib/main.dart:3:19 - Unnecessary use of double quotes. - prefer_single_quotes",
		fields: {
			severity: "notice",
			message: "Unnecessary use of double quotes.",
			file: "lib/main.dart",
			line: "3",
			column: "19",
			code: "prefer_single_quotes",
		},
	},
];

describe("flutter-analyzer.json", () => {
	it("covers every owner in the definition", () => {
		expect(CASES.map((c) => c.owner).sort()).toEqual(
			definition.problemMatcher.map((m) => m.owner).sort(),
		);
	});

	it.each(CASES)("$owner extracts every field", ({ owner, line, fields }) => {
		expect(apply(owner, line)).toEqual(fields);
	});

	// One owner per tool, separator and severity, so a line is annotated once.
	it.each(CASES)("$owner is the only match for its line", ({ owner, line }) => {
		expect(ownersMatching(line)).toEqual([owner]);
	});

	// A severity the runner does not know is dropped with only a debug line, and
	// info is not one it knows, which is why no pattern captures a severity.
	it("declares an accepted severity for every owner", () => {
		for (const matcher of definition.problemMatcher) {
			const level = matcher.owner.split("-")[2] as keyof typeof SEVERITY_OF;

			expect(matcher.severity).toBe(SEVERITY_OF[level]);
			expect(matcher.pattern[0].regexp).toContain(`^\\s*${level}\\s+`);
		}
	});

	it("keeps an absolute Windows path intact", () => {
		expect(
			apply(
				"flutter-analyze-error-dash",
				"  error - Broken - C:\\a\\lib\\main.dart:12:3 - undefined_function",
			)?.file,
		).toBe("C:\\a\\lib\\main.dart");
	});

	it("ignores summary and progress lines", () => {
		for (const line of [
			"Analyzing anlz...",
			"3 issues found. (ran in 0.3s)",
			"No issues found!",
		]) {
			expect(ownersMatching(line)).toEqual([]);
		}
	});

	it("ignores a hyphen inside a message without surrounding spaces", () => {
		expect(
			apply(
				"flutter-analyze-error-dash",
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
