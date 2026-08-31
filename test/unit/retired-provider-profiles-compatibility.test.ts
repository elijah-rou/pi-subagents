import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { discoverAgentsAll } from "../../src/agents/agents.ts";

function snapshotTree(root: string): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	const visit = (directory: string): void => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(absolute);
			else if (entry.isFile()) files.set(path.relative(root, absolute), fs.readFileSync(absolute));
		}
	};
	visit(root);
	return files;
}

describe("retired provider profile compatibility", () => {
	it("leaves saved profiles, provider catalogs, and already-applied settings untouched during ordinary discovery", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-retired-provider-profiles-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		try {
			const agentDir = path.join(root, "agent");
			const profilesDir = path.join(agentDir, "profiles", "pi-subagents");
			const settingsPath = path.join(agentDir, "settings.json");
			fs.mkdirSync(path.join(profilesDir, "providers"), { recursive: true });
			fs.writeFileSync(path.join(profilesDir, "legacy.quota.json"), "{\n  \"subagents\": {\"agentOverrides\": {\"worker\": {\"model\": \"legacy/model\"}}}\n}\n");
			fs.writeFileSync(path.join(profilesDir, "providers", "legacy.models.json"), "{\n  \"provider\": \"legacy\", \"models\": [{\"id\": \"model\"}]\n}\n");
			fs.writeFileSync(settingsPath, JSON.stringify({
				subagents: { agentOverrides: { worker: { model: "openai/gpt-current", thinking: "high" } } },
			}, null, 2));
			process.env.PI_CODING_AGENT_DIR = agentDir;
			const beforeProfiles = snapshotTree(profilesDir);
			const beforeSettings = fs.readFileSync(settingsPath);

			const worker = discoverAgentsAll(root).builtin.find((agent) => agent.name === "worker");
			assert.equal(worker?.model, "openai/gpt-current");
			assert.equal(worker?.thinking, "high");
			assert.deepEqual(snapshotTree(profilesDir), beforeProfiles);
			assert.deepEqual(fs.readFileSync(settingsPath), beforeSettings);
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
