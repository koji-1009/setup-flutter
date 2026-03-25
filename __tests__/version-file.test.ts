import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFvmrc, readPubspec, readVersionFile } from "../src/version-file";

const fixturesDir = join(__dirname, "fixtures");

describe("readPubspec", () => {
	it("reads constraint from pubspec with flutter", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-with-flutter.yaml"))).toBe(
			">=3.29.0 <4.0.0",
		);
	});

	it("reads exact version from pubspec", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-exact.yaml"))).toBe("3.29.0");
	});

	it("throws when flutter is not in environment", () => {
		expect(() =>
			readPubspec(join(fixturesDir, "pubspec-without-flutter.yaml")),
		).toThrow(
			"pubspec-without-flutter.yaml does not contain environment.flutter",
		);
	});

	it("reads constraint from pubspec with quoted inline comment", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-comment.yaml"))).toBe(
			">=3.29.0 <4.0.0",
		);
	});

	it("reads unquoted version from pubspec", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-unquoted.yaml"))).toBe(
			"3.29.0",
		);
	});

	it("reads unquoted version from pubspec with inline comment", () => {
		expect(
			readPubspec(join(fixturesDir, "pubspec-unquoted-comment.yaml")),
		).toBe("3.29.0");
	});

	it("reads constraint from pubspec with single quotes", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-single-quoted.yaml"))).toBe(
			">=3.29.0 <4.0.0",
		);
	});

	it("reads constraint from pubspec with blank lines in environment", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-blank-lines.yaml"))).toBe(
			">=3.29.0 <4.0.0",
		);
	});

	it("returns empty string for empty quoted flutter value", () => {
		expect(readPubspec(join(fixturesDir, "pubspec-empty-quoted.yaml"))).toBe(
			"",
		);
	});

	it("throws for invalid YAML", () => {
		expect(() =>
			readPubspec(join(fixturesDir, "pubspec-invalid.yaml")),
		).toThrow("does not contain environment.flutter");
	});

	it("throws for non-existent file", () => {
		expect(() => readPubspec(join(fixturesDir, "non-existent.yaml"))).toThrow(
			/ENOENT/,
		);
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
		expect(() => readFvmrc(join(fixturesDir, "fvmrc-invalid.json"))).toThrow();
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
