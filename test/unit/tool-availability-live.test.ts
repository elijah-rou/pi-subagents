import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { watchChildToolDiagnostic, writeChildToolDiagnostic } from "../../src/runs/shared/tool-availability.ts";

describe("live child tool diagnostics", () => {
	it("reports one valid missing-tool diagnostic and disposes its watcher", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-tool-diagnostic-"));
		const filePath = path.join(dir, "diagnostic.json");
		const errors: string[] = [];
		const watcher = watchChildToolDiagnostic(filePath, (error) => errors.push(error), { intervalMs: 10 });
		writeChildToolDiagnostic(filePath, ["missing_search"], ["read"], "researcher");
		await new Promise((resolve) => setTimeout(resolve, 150));
		watcher.dispose();
		writeChildToolDiagnostic(filePath, ["other_missing"], ["read"], "researcher");
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(errors.length, 1);
		assert.match(errors[0]!, /researcher.*missing_search/s);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("ignores incomplete atomic-write races until a valid record exists", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-live-tool-race-"));
		const filePath = path.join(dir, "diagnostic.json");
		const errors: string[] = [];
		const watcher = watchChildToolDiagnostic(filePath, (error) => errors.push(error), { intervalMs: 10 });
		fs.writeFileSync(filePath, "{");
		await new Promise((resolve) => setTimeout(resolve, 20));
		writeChildToolDiagnostic(filePath, ["missing_search"], ["read"]);
		await new Promise((resolve) => setTimeout(resolve, 40));
		watcher.dispose();
		assert.equal(errors.length, 1);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
