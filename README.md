# setup-flutter

[![ci](https://github.com/koji-1009/setup-flutter/actions/workflows/ci.yml/badge.svg)](https://github.com/koji-1009/setup-flutter/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/koji-1009/setup-flutter/graph/badge.svg)](https://codecov.io/gh/koji-1009/setup-flutter)
[![license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Set up Flutter SDK for GitHub Actions.

* **Pure TypeScript** — No external tools. Consistent behavior across Linux, macOS, and Windows.
* **SHA-256 verification** — Every downloaded archive is verified against the official manifest to detect tampering.
* **Reliable downloads** — Automatic retry (3 attempts with jitter) and socket/idle timeouts for both HTTP downloads and git operations.
* **Automated maintenance** — Dependencies are kept up to date via Dependabot with auto-merge enabled for patch and minor updates.

## Usage

See [action.yml](action.yml) for the full list of inputs and outputs.

```yaml
steps:
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  - uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  - run: flutter --version
```

Zero configuration installs the latest stable Flutter SDK with caching enabled.

> **Note:** The examples in this README pin a specific version. Always check the [latest release](https://github.com/koji-1009/setup-flutter/releases/latest) for the most recent version. Tools like [pinact](https://github.com/suzuki-shunsuke/pinact) or [Dependabot](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot) can keep your workflow files up to date automatically.

### Specify version

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    flutter-version: '3.41.0'
```

Supports exact versions, ranges (`3.x`, `3.41.x`), and constraints (`>=3.41.0 <4.0.0`).

### Channel

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    channel: beta
```

### Version file

```yaml
# From pubspec.yaml sdk constraint
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    flutter-version-file: pubspec.yaml

# From .fvmrc
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    flutter-version-file: .fvmrc
```

### FVM flavors

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    flutter-version-file: .fvmrc
    fvm-flavor: production
```

### Architecture

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    architecture: arm64
```

Auto-detected if omitted. Supported values: `x64`, `arm64`.

### Matrix testing

```yaml
strategy:
  matrix:
    channel: [stable, beta]
steps:
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  - uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
    with:
      channel: ${{ matrix.channel }}
  - run: flutter test
```

### Caching

SDK and pub caches are enabled by default. To disable:

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    cache-sdk: false
    cache-pub: false
```

Pub caching requires `pubspec.lock` in the working directory.

### Problem matcher

A problem matcher for `flutter analyze` and `dart analyze` is registered by default, turning analyzer diagnostics in later steps into inline annotations on pull requests.

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
- run: flutter analyze
```

Both output layouts are covered: `flutter analyze` prints `severity • message • file:line:column • code`, while `dart analyze` puts the location before the message. The `•` separator is replaced with `-` on Windows, which is also handled.

To disable:

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    problem-matcher: false
```

The matcher is not registered when `dry-run` is enabled.

### Dry run

Resolve version without installing. Useful for checking available versions in CI.

```yaml
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  id: flutter
  with:
    flutter-version: '3.x'
    dry-run: true
- run: echo "${{ steps.flutter.outputs.flutter-version }}"
```

### Git source

Install from a git repository instead of release archives:

```yaml
# master branch
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    git-source: git
    channel: master

# Specific version, resolved to the matching git tag
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    git-source: git
    flutter-version: '3.x'

# Custom fork
- uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
  with:
    git-source: git
    git-source-url: https://github.com/user/flutter-fork.git
    flutter-version: my-branch
```

Version ranges and constraints (e.g. `3.x`, `>=3.10.0 <3.20.0`) are resolved to a concrete git tag, and the action fails if no matching version exists rather than installing the channel HEAD. On the `stable` channel pre-release tags are excluded; `beta` and `master` include them.

> **Note:** Specifying a commit hash as `flutter-version` with `git-source: git` requires a full clone (no `--depth 1`), which is slower. When using git source, `dart-version` output is `unknown` since it is not available from the git metadata.

### China mirror

```yaml
env:
  FLUTTER_STORAGE_BASE_URL: https://storage.flutter-io.cn
steps:
  - uses: koji-1009/setup-flutter@f3f6da93828bdc04c16df16e88984a1bd8f3ce81 # v1.1.3
```

## Outputs

The action sets the following outputs:

| Output            | Description                                       |
| ----------------- | ------------------------------------------------- |
| `flutter-version` | Installed Flutter version                         |
| `dart-version`    | Included Dart SDK version (`unknown` in git mode) |
| `channel`         | Resolved channel                                  |
| `cache-sdk-hit`   | Whether SDK cache was restored                    |
| `cache-pub-hit`   | Whether pub cache was restored                    |
| `architecture`    | Resolved CPU architecture                         |

## Security

The intro bullets above are backed by a consistent design: every artifact this action installs is verified, and no input ever reaches a shell.

* **Archive verification** — Release archives are downloaded over HTTPS and verified against the SHA-256 checksum in the official release manifest before extraction. A mismatch fails the run.
* **Git mode verification** — Versions and refs are resolved to a commit hash first (via the release manifest or `git ls-remote`), and after cloning the checkout is verified to match that commit. SDK caches are keyed by the commit hash and the repository URL.
* **No shell interpolation** — Inputs and version-file contents are passed to subprocesses as argument arrays. Nothing is ever interpolated into a shell command.
* **Supply chain** — All runtime dependencies are bundled into `dist/`, and CI verifies the bundle is reproducible from source on every change. The repository's own workflows are SHA-pinned, run with minimal permissions, and use `npm ci --ignore-scripts` wherever a write token is present.
* **Cache integrity** — Caches are restored by exact key match only. There is no partial-match fallback that could restore unexpected content.

## Blog Post

[Why I Built a New GitHub Action for Flutter](https://koji-1009.medium.com/why-i-built-a-new-github-action-for-flutter-592c24e96a55) — design decisions and motivation behind this action.

## Acknowledgments

Inspired by [subosito/flutter-action](https://github.com/subosito/flutter-action) and [flutter-actions/setup-flutter](https://github.com/flutter-actions/setup-flutter).

The problem matcher support is inspired by [dart-lang/setup-dart](https://github.com/dart-lang/setup-dart) (BSD-3-Clause), which added the same feature in v1.8.0. The matcher patterns in [flutter-analyzer.json](flutter-analyzer.json) were written for this action.

## License

MIT
