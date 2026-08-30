import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createWorkflowState, removeSettledWorkflowState, WORKFLOW_STATE_MAX_BYTES } from "../../src/workflows/workflow-state.ts";

async function childExit(child: ReturnType<typeof spawn>): Promise<void> {
	let stderr = ""; child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
	const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
	assert.deepEqual(result, { code: 0, signal: null }, stderr);
}
function writer(filePath: string, key: string, value: string) {
	return spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", `import { createWorkflowState } from "./src/workflows/workflow-state.ts"; createWorkflowState(process.env.STATE_PATH).set(process.env.STATE_KEY, process.env.STATE_VALUE);`], { cwd: process.cwd(), env: { ...process.env, STATE_PATH: filePath, STATE_KEY: key, STATE_VALUE: value }, stdio: ["ignore", "pipe", "pipe"] });
}

describe("workflow-owned state", () => {
	it("rejects relative, root, and existing-directory paths", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-state-path-"));
		try {
			assert.throws(() => createWorkflowState("relative.json"), /absolute/);
			assert.throws(() => createWorkflowState(path.parse(root).root), /root/);
			const directoryPath = path.join(root, "existing-directory");
			fs.mkdirSync(directoryPath);
			assert.throws(() => createWorkflowState(directoryPath), /directory/);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("preserves paused state and removes only owned state after terminal settlement", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-state-settlement-"));
		try {
			const statePath = path.join(root, "workflow-state.json");
			const statusPath = path.join(root, "status.json");
			fs.writeFileSync(statePath, "{}\n");
			fs.writeFileSync(statusPath, "{}\n");
			assert.equal(removeSettledWorkflowState(statePath, "paused"), false);
			assert.equal(fs.existsSync(statePath), true);
			assert.equal(removeSettledWorkflowState(statePath, "complete"), true);
			assert.equal(fs.existsSync(statePath), false);
			assert.equal(fs.existsSync(statusPath), true);
			assert.throws(() => removeSettledWorkflowState(statusPath, "failed"), /owned workflow-state\.json/);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("uses the caller-owned file directly and enforces JSON, key, byte, and permissions bounds", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-state-"));
		try {
			const filePath = path.join(root, "owned.workflow-state.json");
			const state = createWorkflowState(filePath);
			assert.equal(state.path, filePath);
			state.set("review.status", { ready: true });
			assert.deepEqual(createWorkflowState(filePath).get("review.status"), { ready: true });
			assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
			assert.throws(() => state.set("bad key", true), /state key/);
			assert.throws(() => state.set("bad-json", undefined), /JSON/);
			assert.throws(() => state.set("too-large", "x".repeat(WORKFLOW_STATE_MAX_BYTES)), /256 KiB/);
			assert.equal(fs.existsSync(path.join(root, "mission.json")), false);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("serializes cross-process writes", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-state-lock-"));
		try {
			const filePath = path.join(root, "state.json");
			await Promise.all([childExit(writer(filePath, "reviewer", "ready")), childExit(writer(filePath, "approved", "false"))]);
			assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf-8")), { reviewer: "ready", approved: "false" });
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("recovers stale, reused-pid, and competing recovery locks", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-workflow-state-stale-"));
		try {
			for (const [name, owner] of [["aged", undefined], ["reused", { pid: process.pid, token: "abandoned", createdAt: Date.now(), processKey: "stale-process" }]] as const) {
				const filePath = path.join(root, `${name}.json`); const lockPath = `${filePath}.lock`;
				fs.mkdirSync(lockPath, { recursive: true });
				if (owner) fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify(owner)); else { const stale = new Date(Date.now() - 120_000); fs.utimesSync(lockPath, stale, stale); }
				createWorkflowState(filePath).set("recovered", true);
				assert.equal(fs.existsSync(lockPath), false);
			}
			const competing = path.join(root, "competing.json"); const lockPath = `${competing}.lock`;
			fs.mkdirSync(lockPath); const stale = new Date(Date.now() - 120_000); fs.utimesSync(lockPath, stale, stale);
			await Promise.all([childExit(writer(competing, "one", "1")), childExit(writer(competing, "two", "2"))]);
			assert.deepEqual(JSON.parse(fs.readFileSync(competing, "utf-8")), { one: "1", two: "2" });
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});
});
