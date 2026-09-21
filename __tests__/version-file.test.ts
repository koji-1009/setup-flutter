import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFvmrc, readPubspec, readVersionFile } from "../src/version-file";

const fixturesDir = join(__dirname, "fixtures");

describe("readPubspec", () => {
	it.each([
		{ file: "pubspec-with-flutter.yaml", expected: ">=3.29.0 <4.0.0" },
		{ file: "pubspec-exact.yaml", expected: "3.29.0" },
		{ file: "pubspec-comment.yaml", expected: ">=3.29.0 <4.0.0" },
		{ file: "pubspec-unquoted.yaml", expected: "3.29.0" },
		{ file: "pubspec-unquoted-comment.yaml", expected: "3.29.0" },
		{ file: "pubspec-single-quoted.yaml", expected: ">=3.29.0 <4.0.0" },
		{ file: "pubspec-blank-lines.yaml", expected: ">=3.29.0 <4.0.0" },
		// A comment is not indented content, so it does not close the block.
		{ file: "pubspec-column-zero-comment.yaml", expected: ">=3.29.0 <4.0.0" },
		{ file: "pubspec-empty-quoted.yaml", expected: "" },
	])("reads '$expected' from $file", ({ file, expected }) => {
		expect(readPubspec(join(fixturesDir, file))).toBe(expected);
	});

	it.each([
		{
			file: "pubspec-without-flutter.yaml",
			error:
				"pubspec-without-flutter.yaml does not contain environment.flutter",
		},
		{
			file: "pubspec-invalid.yaml",
			error: "does not contain environment.flutter",
		},
		{ file: "non-existent.yaml", error: /ENOENT/ },
	])("throws for $file", ({ file, error }) => {
		expect(() => readPubspec(join(fixturesDir, file))).toThrow(error);
	});
});

describe("readFvmrc", () => {
	it("reads flutter version from basic fvmrc", () => {
		expect(readFvmrc(join(fixturesDir, "fvmrc-basic.json"))).toBe("3.29.0");
	});

	it("reads channel from fvmrc", () => {
		expect(readFvmrc(join(fixturesDir, "fvmrc-channel.json"))).toBe("beta");
	});

	it("reads flavor development from fvmrc", () => {
		expect(
			readFvmrc(join(fixturesDir, "fvmrc-flavors.json"), "development"),
		).toBe("beta");
	});

	it("reads flavor staging from fvmrc", () => {
		expect(readFvmrc(join(fixturesDir, "fvmrc-flavors.json"), "staging")).toBe(
			"3.27.0",
		);
	});

	it("throws when flutter field is missing", () => {
		expect(() =>
			readFvmrc(join(fixturesDir, "fvmrc-missing-flutter.json")),
		).toThrow("flutter field not found");
	});

	it("throws when flavor does not exist", () => {
		expect(() =>
			readFvmrc(join(fixturesDir, "fvmrc-flavors.json"), "nonexistent"),
		).toThrow("FVM flavor 'nonexistent' not found");
	});

	it("throws for invalid JSON", () => {
		expect(() => readFvmrc(join(fixturesDir, "fvmrc-invalid.json"))).toThrow(
			SyntaxError,
		);
	});
});

describe("readVersionFile", () => {
	it("reads pubspec.yaml", () => {
		const result = readVersionFile(
			join(fixturesDir, "pubspec-dir", "pubspec.yaml"),
		);
		expect(result).toBe(">=3.29.0 <4.0.0");
	});

	it("reads pubspec.yml", () => {
		const result = readVersionFile(
			join(fixturesDir, "pubspec-dir", "pubspec.yml"),
		);
		expect(result).toBe(">=3.29.0 <4.0.0");
	});

	it("reads .fvmrc", () => {
		const result = readVersionFile(join(fixturesDir, ".fvmrc"));
		expect(result).toBe("3.29.0");
	});

	it("throws for unsupported file type", () => {
		expect(() => readVersionFile(join(fixturesDir, "unknown.txt"))).toThrow(
			"Unsupported version file",
		);
	});
});
