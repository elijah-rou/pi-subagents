import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	createPrivateDirectoryExclusive,
	prepareProjectStateWriteDir,
	resolvePrivateRuntimeRoot,
	resolveProjectStateLocation,
	selectProjectStateReadDir,
} from "../../src/shared/external-state.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): { project: string; data: string; state: string; runtime: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-generated-state-"));
	roots.push(root);
	const project = path.join(root, "project");
	fs.mkdirSync(path.join(project, ".git"), { recursive: true });
	return { project, data: path.join(root, "xdg-data"), state: path.join(root, "xdg-state"), runtime: path.join(root, "xdg-runtime") };
}

describe("external generated artifacts and runtime", () => {
	it("uses a stable canonical-project artifact namespace with private directories", () => {
		const input = fixture();
		const env = { XDG_DATA_HOME: input.data };
		const first = resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env });
		const second = resolveProjectStateLocation(path.join(input.project, "."), "artifacts", ".pi-subagents/artifacts", { env });
		assert.equal(first.primaryDir, second.primaryDir);
		assert.equal(first.primaryDir.startsWith(input.project + path.sep), false);
		prepareProjectStateWriteDir(first);
		for (const dir of [path.join(input.data, "pi-subagents"), path.dirname(first.primaryDir), first.primaryDir]) {
			assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
		}
	});

	it("reads legacy artifacts as fallback but always writes new artifacts externally", () => {
		const input = fixture();
		const location = resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: { XDG_DATA_HOME: input.data } });
		fs.mkdirSync(location.legacyDir, { recursive: true });
		fs.writeFileSync(path.join(location.legacyDir, "old.jsonl"), "legacy", "utf-8");
		assert.equal(selectProjectStateReadDir(location), location.legacyDir);
		assert.equal(prepareProjectStateWriteDir(location), location.primaryDir);
		assert.equal(fs.readFileSync(path.join(location.legacyDir, "old.jsonl"), "utf-8"), "legacy");
	});

	it("reports an explicit inspection conflict when both artifact locations exist", () => {
		const input = fixture();
		const location = resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: { XDG_DATA_HOME: input.data } });
		fs.mkdirSync(location.legacyDir, { recursive: true });
		prepareProjectStateWriteDir(location);
		assert.throws(() => selectProjectStateReadDir(location), /conflict/i);
	});

	it("rejects symlinked or broadly accessible shared runtime roots", () => {
		const input = fixture();
		fs.mkdirSync(input.runtime, { mode: 0o755 });
		assert.throws(() => resolvePrivateRuntimeRoot({ XDG_RUNTIME_DIR: input.runtime }), /mode 0700/);
		fs.chmodSync(input.runtime, 0o700);
		const root = resolvePrivateRuntimeRoot({ XDG_RUNTIME_DIR: input.runtime });
		assert.equal(fs.statSync(root).mode & 0o777, 0o700);
	});

	it("creates run directories exclusively and rejects stale or intermediate symlink collisions", () => {
		const input = fixture();
		const runDir = path.join(input.state, "runs", "run-1");
		createPrivateDirectoryExclusive(runDir);
		assert.equal(fs.statSync(runDir).mode & 0o777, 0o700);
		assert.throws(() => createPrivateDirectoryExclusive(runDir), /already exists/);

		const outside = path.join(path.dirname(input.state), "outside");
		fs.mkdirSync(outside, { mode: 0o700 });
		const linkedParent = path.join(path.dirname(input.state), "linked-parent");
		fs.symlinkSync(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");
		assert.throws(() => createPrivateDirectoryExclusive(path.join(linkedParent, "child", "run-2")), /must not be a symlink/);
	});

	it("rejects direct and symlinked generated destinations inside a Git worktree", () => {
		const input = fixture();
		assert.throws(
			() => resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: { XDG_DATA_HOME: path.join(input.project, ".state") } }),
			/inside Git worktree/,
		);
		const linkedRoot = path.join(path.dirname(input.project), "linked-data");
		fs.symlinkSync(input.project, linkedRoot, process.platform === "win32" ? "junction" : "dir");
		assert.throws(
			() => resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: { XDG_DATA_HOME: path.join(linkedRoot, "missing") } }),
			/inside Git worktree/,
		);
	});

	it("ignores relative XDG homes", () => {
		const input = fixture();
		const fallback = resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: {} });
		const relative = resolveProjectStateLocation(input.project, "artifacts", ".pi-subagents/artifacts", { env: { XDG_DATA_HOME: "relative-data" } });
		assert.equal(relative.primaryDir, fallback.primaryDir);
	});
});
