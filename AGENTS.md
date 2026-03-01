# AGENTS.md

* **`dist/` is committed**: GitHub Actions loads `dist/` directly from the tagged commit. Run `npm run package` and commit the result after any source change.
* **`action.yml` is the source of truth for node version**: `build.mjs` parses it to set the esbuild target. Do not hardcode node versions elsewhere.
* **SHA-256 single-pass**: Download and hash use one `pipeline()` pass. Do not split into separate steps.
* **Pub cache key excludes OS**: Dart packages are platform-independent. Do not add OS to the key.
* **ESM mocking**: Use `vi.mock()` + `Mocked<typeof>`, not `vi.spyOn()` on module namespaces. Class mocks must use class fields (`get = vi.fn()...`), not prototype methods.
* **Test coverage must stay at 100%**: Statements, branches, functions, and lines are all 100%. Run `npx vitest run --coverage` to verify after any change.
