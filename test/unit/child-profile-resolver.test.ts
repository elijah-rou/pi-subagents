import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	registerSubagentChildProfileResolver,
	resolveSubagentChildProfile,
} from "../../src/api/child-profile-resolver.ts";

describe("subagent child profile resolver", () => {
	it("resolves an exact-session child profile", async () => {
		const sessionId = `profile-${Date.now()}-${Math.random()}`;
		const handle = registerSubagentChildProfileResolver({
			sessionId,
			source: "profile-router",
			resolve: async (request) => request.parallel
				? { profile: "explore", model: "openai-codex/gpt-5.6-luna", thinking: "xhigh", confidence: 91 }
				: null,
		});
		try {
			assert.deepEqual(await resolveSubagentChildProfile(sessionId, { agent: "scout", task: "Map the code", cwd: "/tmp", parallel: true }), {
				selection: { profile: "explore", model: "openai-codex/gpt-5.6-luna", thinking: "xhigh", confidence: 91, source: "profile-router" },
				warnings: [],
			});
			assert.deepEqual(await resolveSubagentChildProfile(`${sessionId}-other`, { agent: "scout", task: "Map", cwd: "/tmp", parallel: true }), { warnings: [] });
		} finally {
			handle.dispose();
		}
	});

	it("fails open when a resolver throws or returns malformed data", async () => {
		const sessionId = `profile-errors-${Date.now()}-${Math.random()}`;
		const malformed = registerSubagentChildProfileResolver({ sessionId, source: "malformed", resolve: async () => ({ profile: "bad", model: "", confidence: 200 }) });
		const throwing = registerSubagentChildProfileResolver({ sessionId, source: "throwing", resolve: async () => { throw new Error("offline"); } });
		try {
			const result = await resolveSubagentChildProfile(sessionId, { agent: "worker", task: "Implement", cwd: "/tmp", parallel: false });
			assert.equal(result.selection, undefined);
			assert.equal(result.warnings.length, 2);
			assert.match(result.warnings.join("\n"), /malformed/);
			assert.match(result.warnings.join("\n"), /offline/);
		} finally {
			throwing.dispose();
			malformed.dispose();
		}
	});

	it("stops at the first valid resolver and rejects updates after disposal", async () => {
		const sessionId = `profile-order-${Date.now()}-${Math.random()}`;
		let laterCalls = 0;
		const first = registerSubagentChildProfileResolver({ sessionId, source: "first", resolve: async () => ({ profile: "standard", model: "openai-codex/gpt-5.6-sol", thinking: "medium", confidence: 80 }) });
		const later = registerSubagentChildProfileResolver({ sessionId, source: "later", resolve: async () => { laterCalls += 1; return null } });
		try {
			const result = await resolveSubagentChildProfile(sessionId, { agent: "worker", task: "Implement", cwd: "/tmp", parallel: false });
			assert.equal(result.selection?.profile, "standard");
			assert.equal(laterCalls, 0);
		} finally {
			later.dispose();
			first.dispose();
		}
		assert.throws(() => first.update(async () => null), /disposed/);
	});
});
