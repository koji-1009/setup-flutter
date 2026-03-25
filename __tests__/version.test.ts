import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import {
	type FlutterManifest,
	fetchManifest,
	parseVersionSpec,
	resolveFromManifest,
} from "../src/version";

vi.mock("@actions/http-client");

const linuxFixture: FlutterManifest = JSON.parse(
	readFileSync(join(__dirname, "fixtures", "releases_linux.json"), "utf8"),
);

const macosFixture: FlutterManifest = JSON.parse(
	readFileSync(join(__dirname, "fixtures", "releases_macos.json"), "utf8"),
);

describe("parseVersionSpec", () => {
	it("returns any for empty string", () => {
		expect(parseVersionSpec("")).toEqual({ type: "any" });
	});

	it('returns any for "any"', () => {
		expect(parseVersionSpec("any")).toEqual({ type: "any" });
	});

	it("returns channel for stable", () => {
		expect(parseVersionSpec("stable")).toEqual({
			type: "channel",
			channel: "stable",
		});
	});

	it("returns channel for beta", () => {
		expect(parseVersionSpec("beta")).toEqual({
			type: "channel",
			channel: "beta",
		});
	});

	it("returns channel for master", () => {
		expect(parseVersionSpec("master")).toEqual({
			type: "channel",
			channel: "master",
		});
	});

	it("returns constraint for >=", () => {
		expect(parseVersionSpec(">=3.38.0 <3.42.0")).toEqual({
			type: "constraint",
			range: ">=3.38.0 <3.42.0",
		});
	});

	it("returns constraint for ^", () => {
		expect(parseVersionSpec("^3.27.0")).toEqual({
			type: "constraint",
			range: "^3.27.0",
		});
	});

	it("returns ref for ~ (not a Dart constraint)", () => {
		expect(parseVersionSpec("~3.27.0")).toEqual({
			type: "ref",
			ref: "~3.27.0",
		});
	});

	it("returns constraint for <", () => {
		expect(parseVersionSpec("<4.0.0")).toEqual({
			type: "constraint",
			range: "<4.0.0",
		});
	});

	it("returns constraint for >", () => {
		expect(parseVersionSpec(">3.0.0")).toEqual({
			type: "constraint",
			range: ">3.0.0",
		});
	});

	it("returns constraint for <=", () => {
		expect(parseVersionSpec("<=3.29.0")).toEqual({
			type: "constraint",
			range: "<=3.29.0",
		});
	});

	it("returns range for 3.x", () => {
		expect(parseVersionSpec("3.x")).toEqual({ type: "range", major: 3 });
	});

	it("returns range for 3.41.x", () => {
		expect(parseVersionSpec("3.41.x")).toEqual({
			type: "range",
			major: 3,
			minor: 41,
		});
	});

	it("returns exact for 3.27.0", () => {
		expect(parseVersionSpec("3.27.0")).toEqual({
			type: "exact",
			version: "3.27.0",
		});
	});

	it("returns exact for 3.41.2", () => {
		expect(parseVersionSpec("3.41.2")).toEqual({
			type: "exact",
			version: "3.41.2",
		});
	});

	it("returns ref for commit hash", () => {
		expect(parseVersionSpec("abc1234")).toEqual({
			type: "ref",
			ref: "abc1234",
		});
	});

	it("returns ref for branch name", () => {
		expect(parseVersionSpec("my-feature-branch")).toEqual({
			type: "ref",
			ref: "my-feature-branch",
		});
	});

	it("returns ref for branch name containing x", () => {
		expect(parseVersionSpec("fix-navigation")).toEqual({
			type: "ref",
			ref: "fix-navigation",
		});
	});

	it('returns ref for "next"', () => {
		expect(parseVersionSpec("next")).toEqual({ type: "ref", ref: "next" });
	});

	it('returns ref for "dev" (unsupported channel)', () => {
		expect(parseVersionSpec("dev")).toEqual({ type: "ref", ref: "dev" });
	});

	it("returns exact for pre-release version 3.29.0-0.1.pre", () => {
		expect(parseVersionSpec("3.29.0-0.1.pre")).toEqual({
			type: "exact",
			version: "3.29.0-0.1.pre",
		});
	});

	it("returns any for whitespace-only input", () => {
		expect(parseVersionSpec("   ")).toEqual({ type: "any" });
	});

	it("trims whitespace", () => {
		expect(parseVersionSpec("  3.41.2  ")).toEqual({
			type: "exact",
			version: "3.41.2",
		});
	});
});

describe("resolveFromManifest (linux)", () => {
	it("resolves exact version 3.27.0 on stable", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "exact", version: "3.27.0" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.27.0");
		expect(result?.channel).toBe("stable");
		expect(result?.sha256).toBe(
			"c0592133cc61d7c4d42762287de84b7e0bafdd3fd62eb26eaadb342c4309d541",
		);
	});

	it("returns null for non-existent exact version", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "exact", version: "9.99.99" },
			"stable",
			"x64",
		);
		expect(result).toBeNull();
	});

	it("resolves range 3.x to latest 3.x stable", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "range", major: 3 },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
	});

	it("resolves range 3.41.x to 3.41.2", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "range", major: 3, minor: 41 },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
	});

	it("resolves any on stable to latest stable", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "any" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
	});

	it("resolves constraint >=3.38.0 <3.42.0 to 3.41.2", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "constraint", range: ">=3.38.0 <3.42.0" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
	});

	it("resolves constraint ^3.27.0 to latest 3.x", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "constraint", range: "^3.27.0" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
	});

	it("resolves constraint with pre-release version on beta", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "constraint", range: ">=3.27.0" },
			"beta",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.42.0-0.1.pre");
	});

	it("resolves constraint ^3.27.0 with pre-release version on beta", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "constraint", range: "^3.27.0" },
			"beta",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.42.0-0.1.pre");
	});

	it("resolves channel beta to latest beta", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "channel", channel: "beta" },
			"beta",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.42.0-0.1.pre");
	});

	it("resolves exact pre-release version from beta channel", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "exact", version: "3.42.0-0.1.pre" },
			"beta",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.42.0-0.1.pre");
		expect(result?.channel).toBe("beta");
	});

	it("uses channel argument as authoritative filter, not spec.channel", () => {
		// spec says "beta" but channel argument says "stable" — the argument wins
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "channel", channel: "beta" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.channel).toBe("stable");
	});

	it("returns null for arm64 on linux (no arm64 entries)", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "any" },
			"stable",
			"arm64",
		);
		expect(result).toBeNull();
	});

	it("resolves x64 with explicit dart_sdk_arch", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "exact", version: "3.41.2" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
		expect(result?.sha256).toBe(
			"4a04f8a6152986d14fc137ffaf98106ca743c0f9ab66f1bc2f20ee84eb573e5c",
		);
	});

	it("returns null for constraint matching no releases", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "constraint", range: ">=9.0.0" },
			"stable",
			"x64",
		);
		expect(result).toBeNull();
	});

	it("throws for ref spec in release mode", () => {
		expect(() => {
			resolveFromManifest(
				linuxFixture,
				{ type: "ref", ref: "abc1234" },
				"stable",
				"x64",
			);
		}).toThrow("ref spec cannot be used with release mode");
	});

	it("builds correct downloadUrl", () => {
		const result = resolveFromManifest(
			linuxFixture,
			{ type: "exact", version: "3.41.2" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.downloadUrl).toBe(
			"https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.41.2-stable.tar.xz",
		);
	});
});

describe("resolveFromManifest (macos x64 skips arm64)", () => {
	it("skips arm64 entries when resolving for x64", () => {
		const manifest: FlutterManifest = {
			base_url: "https://storage.googleapis.com/flutter_infra_release/releases",
			current_release: { stable: "hash1" },
			releases: [
				{
					hash: "hash1",
					channel: "stable",
					version: "3.41.2",
					dart_sdk_version: "3.11.0",
					dart_sdk_arch: "arm64",
					release_date: "2026-01-01",
					archive: "stable/macos/flutter_macos_arm64_3.41.2-stable.zip",
					sha256: "arm64hash",
				},
				{
					hash: "hash1",
					channel: "stable",
					version: "3.41.2",
					dart_sdk_version: "3.11.0",
					dart_sdk_arch: "x64",
					release_date: "2026-01-01",
					archive: "stable/macos/flutter_macos_3.41.2-stable.zip",
					sha256: "x64hash",
				},
			],
		};
		const result = resolveFromManifest(
			manifest,
			{ type: "any" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.sha256).toBe("x64hash");
	});
});

describe("resolveFromManifest (macos arm64)", () => {
	it("resolves arm64 to arm64 entry", () => {
		const result = resolveFromManifest(
			macosFixture,
			{ type: "any" },
			"stable",
			"arm64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
		expect(result?.arch).toBe("arm64");
		expect(result?.sha256).toBe(
			"6650a1528233cb06fd82571876439ef0e8b5c6d681d09b815b08dbcc31eb9497",
		);
	});

	it("resolves x64 to x64 entry on macos", () => {
		const result = resolveFromManifest(
			macosFixture,
			{ type: "exact", version: "3.41.2" },
			"stable",
			"x64",
		);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3.41.2");
		expect(result?.sha256).toBe(
			"027a9a0756d464b3a1c0ba491c82b02b2c2a2118f649b2f545dac91a76be4ade",
		);
	});
});

const { HttpClient } = (await import("@actions/http-client")) as {
	HttpClient: Mock;
};

describe("fetchManifest", () => {
	const originalEnv = process.env.FLUTTER_STORAGE_BASE_URL;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.FLUTTER_STORAGE_BASE_URL;
		} else {
			process.env.FLUTTER_STORAGE_BASE_URL = originalEnv;
		}
	});

	it("fetches and returns manifest", async () => {
		HttpClient.mockImplementation(
			class {
				getJson = vi.fn().mockResolvedValue({
					result: JSON.parse(JSON.stringify(linuxFixture)),
				});
			},
		);

		const result = await fetchManifest("linux");
		expect(result.releases.length).toBeGreaterThan(0);
		expect(result.base_url).toContain("flutter_infra_release");
	});

	it("rewrites base_url when FLUTTER_STORAGE_BASE_URL is set", async () => {
		process.env.FLUTTER_STORAGE_BASE_URL = "https://mirror.example.com";

		HttpClient.mockImplementation(
			class {
				getJson = vi.fn().mockResolvedValue({
					result: JSON.parse(JSON.stringify(linuxFixture)),
				});
			},
		);

		const result = await fetchManifest("linux");
		expect(result.base_url).toBe(
			"https://mirror.example.com/flutter_infra_release/releases",
		);
	});

	it("throws when result is null", async () => {
		HttpClient.mockImplementation(
			class {
				getJson = vi.fn().mockResolvedValue({ result: null });
			},
		);

		await expect(fetchManifest("linux")).rejects.toThrow(
			"Failed to fetch manifest",
		);
	});
});
