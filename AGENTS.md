# AGENTS.md

* **`dist/` is committed**: GitHub Actions loads `dist/` directly from the tagged commit. Run `npm run package` and commit the result after any source change.
* **`action.yml` is the source of truth for node version**: `build.mjs` parses it to set the esbuild target. Do not hardcode node versions elsewhere.
* **SHA-256 single-pass**: Download and hash use one `pipeline()` pass. Do not split into separate steps.
* **Retry wraps download + verify**: `downloadAndVerify` retries the entire `downloadWithHash` + SHA-256 check as a unit. Do not retry at the HTTP layer alone — a corrupted transfer must re-download from scratch.
* **Timeouts use native mechanisms**: HTTP uses `HttpClient`'s `socketTimeout` (idle detection). Git uses `GIT_HTTP_LOW_SPEED_LIMIT`/`GIT_HTTP_LOW_SPEED_TIME` env vars (git-native idle detection) plus `execWithTimeout` (total command timeout). Do not replace with custom polling.
* **Cache keys include OS**: Both SDK and pub cache keys include the OS name for easier cache management in the GitHub Actions UI, even though `@actions/cache` internally scopes by runner OS.
* **ESM mocking**: Use `vi.mock()` + `Mocked<typeof>`, not `vi.spyOn()` on module namespaces. Class mocks must use class fields (`get = vi.fn()...`), not prototype methods.
* **Timeout tests require handler-first ordering**: When testing `execWithTimeout` with fake timers, set up the rejection handler (`expect(promise).rejects`) before advancing timers to avoid unhandled rejections.
* **Test coverage must stay at 100%**: Statements, branches, functions, and lines are all 100%. Run `npx vitest run --coverage` to verify after any change.
