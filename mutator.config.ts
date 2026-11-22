import { defineConfig } from "@mizchi/mutator";

export default defineConfig({
	include: ["src/**/*.ts"],
	// core.info() only writes progress to the log, like the default console.* / debug arid callees.
	arid: { callees: ["info"] },
	failOnSurvived: true,
});
