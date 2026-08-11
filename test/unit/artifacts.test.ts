import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	getArtifactsDir,
	getProjectArtifactPackagingWarning,
	getChainRunsDir,
	getProjectArtifactsDir,
	getProjectChainRunsDir,
	getProjectSubagentsDir,
	appendJsonl,
	writeArtifact,
	writeMetadata,
} from "../../src/shared/artifacts.ts";
import { CHAIN_RUNS_DIR } from "../../src/shared/types.ts";

describe("project-local artifact paths", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});

	function packageDir(packageJson: object, ignore?: { name: ".npmignore" | ".gitignore"; content: string }): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-artifacts-"));
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson), "utf-8");
		if (ignore) fs.writeFileSync(path.join(dir, ignore.name), ignore.content, "utf-8");
		return dir;
	}

	it("does not warn about package inclusion after generated artifacts moved outside projects", () => {
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "unsafe" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "gitignored" }, { name: ".gitignore", content: ".pi-subagents/\n" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "globignored" }, { name: ".npmignore", content: "**/.pi-subagents/**\n" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "classignored" }, { name: ".npmignore", content: "[.]pi-subagents/**\n" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "explicit-files-over-ignore", files: [".pi-subagents/**"] }, { name: ".npmignore", content: ".pi-subagents/\n" })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "restricted", files: ["src/**"] })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "malformed-pattern", files: ["[z-a]"] })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "broad", files: ["**/*"] })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "root-wildcard", files: ["*"] })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "included", files: [".pi-subagents/**"] })), undefined);
		assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "excluded-after-include", files: [".pi-subagents/**", "!.pi-subagents/**"] })), undefined);
		for (const files of [[".pi-subagents/artifacts/**"], [".pi-subagents/artifacts"], [".pi-subagents/artifacts/*_input.md"], [".pi-subagents/artifacts/*_output.md"], [".pi-subagents/artifacts/*.jsonl"], [".pi-subagents/artifacts/*_meta.json"], [".pi-subagents/artifacts/progress/**"], [".pi-subagents/artifacts/outputs/**"], [".pi-subagents/artifacts/outputs/*/*.md"], [".pi-subagents/chain-runs/**"], [".pi-subagents/chain-runs"]]) {
			assert.equal(getProjectArtifactPackagingWarning(packageDir({ name: "legacy", files })), undefined);
		}
	});

	it("places generated subagent files in stable external project namespaces", () => {
		const cwd = packageDir({ name: "project" });
		const artifacts = getProjectArtifactsDir(cwd);
		assert.equal(artifacts.startsWith(cwd + path.sep), false);
		assert.equal(getProjectSubagentsDir(cwd), path.join(cwd, ".pi-subagents"));
		assert.equal(getArtifactsDir(null, cwd), artifacts);
		assert.equal(getProjectChainRunsDir(cwd).startsWith(cwd + path.sep), false);
	});

	it("routes chain scratch files according to the artifact preference", () => {
		const cwd = packageDir({ name: "chain-project" });
		assert.equal(getChainRunsDir(cwd), getProjectChainRunsDir(cwd));
		assert.equal(getChainRunsDir(cwd, "project"), getProjectChainRunsDir(cwd));
		assert.equal(getChainRunsDir(cwd, "session"), CHAIN_RUNS_DIR);
		assert.equal(getChainRunsDir(cwd, "temp"), CHAIN_RUNS_DIR);
	});

	it("keeps the session artifact fallback when no project cwd is available", () => {
		const sessionFile = path.join("tmp", "sessions", "parent.jsonl");
		assert.equal(getArtifactsDir(sessionFile), path.join("tmp", "sessions", "subagent-artifacts"));
	});

	it("writes private artifact files and rejects hostile final symlinks", () => {
		const dir = packageDir({ name: "private-artifacts" });
		const artifactsDir = path.join(path.dirname(dir), `${path.basename(dir)}-external`);
		tempDirs.push(artifactsDir);
		fs.mkdirSync(artifactsDir, { mode: 0o700 });
		const existing = path.join(artifactsDir, "existing.md");
		fs.writeFileSync(existing, "old", { mode: 0o644 });
		writeArtifact(existing, "new");
		assert.equal(fs.statSync(existing).mode & 0o777, 0o600);
		const metadata = path.join(artifactsDir, "meta.json");
		writeMetadata(metadata, { private: true });
		assert.equal(fs.statSync(metadata).mode & 0o777, 0o600);
		const jsonl = path.join(artifactsDir, "events.jsonl");
		appendJsonl(jsonl, "{}");
		assert.equal(fs.statSync(jsonl).mode & 0o777, 0o600);

		const victim = path.join(artifactsDir, "victim");
		fs.writeFileSync(victim, "untouched", { mode: 0o644 });
		const hostile = path.join(artifactsDir, "hostile.jsonl");
		fs.symlinkSync(victim, hostile);
		assert.throws(() => appendJsonl(hostile, "attack"), /symlink|regular file/i);
		const hostileMetadata = path.join(artifactsDir, "hostile-meta.json");
		fs.symlinkSync(victim, hostileMetadata);
		assert.throws(() => writeMetadata(hostileMetadata, { attack: true }), /symlink|regular file/i);
		assert.equal(fs.readFileSync(victim, "utf-8"), "untouched");
		assert.equal(fs.statSync(victim).mode & 0o777, 0o644);
	});
});
