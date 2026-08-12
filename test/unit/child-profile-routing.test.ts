import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerSubagentChildProfileResolver } from "../../src/api/child-profile-resolver.ts";
import { applySubagentChildProfiles } from "../../src/runs/shared/child-profile-routing.ts";

describe("subagent child profile routing", () => {
	it("routes single, parallel, and sequential children while preserving explicit models", async () => {
		const sessionId = `routing-${Date.now()}-${Math.random()}`;
		const seen: Array<{ agent: string; parallel: boolean }> = [];
		const handle = registerSubagentChildProfileResolver({
			sessionId,
			source: "profile-router",
			resolve: async (request) => {
				seen.push({ agent: request.agent, parallel: request.parallel });
				return request.parallel
					? { profile: "explore", model: "test/luna", thinking: "xhigh", confidence: 90 }
					: { profile: "standard", model: "test/sol", thinking: "medium", confidence: 90 };
			},
		});
		try {
			const routed = await applySubagentChildProfiles({
				tasks: [{ agent: "scout", task: "Map" }, { agent: "reviewer", task: "Review", model: "test/explicit" }],
				chain: [
					{ agent: "worker", task: "Implement" },
					{ parallel: [{ agent: "reviewer", task: "Correctness" }, { agent: "reviewer", task: "Tests" }] },
				],
			}, { sessionId, cwd: "/tmp" });
			assert.equal(routed.tasks?.[0]?.model, "test/luna:xhigh");
			assert.equal(routed.tasks?.[1]?.model, "test/explicit");
			assert.equal((routed.chain?.[0] as { model?: string }).model, "test/sol:medium");
			assert.deepEqual((routed.chain?.[1] as { parallel: Array<{ model?: string }> }).parallel.map((item) => item.model), ["test/luna:xhigh", "test/luna:xhigh"]);
			assert.deepEqual(seen, [
				{ agent: "scout", parallel: true },
				{ agent: "worker", parallel: false },
				{ agent: "reviewer", parallel: true },
				{ agent: "reviewer", parallel: true },
			]);
		} finally {
			handle.dispose();
		}
	});

	it("keeps transformed serial workflow tasks serial", async () => {
		const sessionId = `routing-serial-${Date.now()}-${Math.random()}`;
		let parallel = true;
		const handle = registerSubagentChildProfileResolver({ sessionId, source: "test", resolve: async (request) => { parallel = request.parallel; return null } });
		try {
			await applySubagentChildProfiles({ tasks: [{ agent: "worker", task: "Inspect" }] }, { sessionId, cwd: "/tmp", tasksParallel: false });
			assert.equal(parallel, false);
		} finally {
			handle.dispose();
		}
	});

	it("preserves top-level model and thinking defaults for tasks and chains", async () => {
		const sessionId = `routing-defaults-${Date.now()}-${Math.random()}`;
		let calls = 0;
		const handle = registerSubagentChildProfileResolver({ sessionId, source: "test", resolve: async () => { calls += 1; return { profile: "standard", model: "test/routed", confidence: 90 } } });
		try {
			const modelDefault = await applySubagentChildProfiles({ model: "test/explicit", tasks: [{ agent: "worker", task: "One" }] }, { sessionId, cwd: "/tmp" });
			const thinkingDefault = await applySubagentChildProfiles({ thinking: "high", chain: [{ agent: "worker", task: "Two" }] }, { sessionId, cwd: "/tmp" });
			assert.equal((modelDefault.tasks?.[0] as { model?: string } | undefined)?.model, undefined);
			assert.equal((thinkingDefault.chain?.[0] as { model?: string }).model, undefined);
			assert.equal(calls, 0);
		} finally {
			handle.dispose();
		}
	});

	it("routes a direct child and skips routing when model or thinking is explicit", async () => {
		const sessionId = `routing-direct-${Date.now()}-${Math.random()}`;
		let calls = 0;
		const handle = registerSubagentChildProfileResolver({ sessionId, source: "test", resolve: async () => { calls += 1; return { profile: "standard", model: "test/sol", thinking: "high", confidence: 80 } } });
		try {
			const routed = await applySubagentChildProfiles({ agent: "worker", task: "Implement" }, { sessionId, cwd: "/tmp" });
			const explicit = await applySubagentChildProfiles({ agent: "worker", task: "Implement", model: "test/explicit" }, { sessionId, cwd: "/tmp" });
			const thinkingOnly = await applySubagentChildProfiles({ agent: "worker", task: "Implement", thinking: "low" }, { sessionId, cwd: "/tmp" });
			const delegatedThinking = await applySubagentChildProfiles({ agent: "worker", task: "Implement" }, { sessionId, cwd: "/tmp", disabled: true });
			assert.equal((routed as { model?: string }).model, "test/sol:high");
			assert.equal(explicit.model, "test/explicit");
			assert.equal((thinkingOnly as { model?: string }).model, undefined);
			assert.equal((delegatedThinking as { model?: string }).model, undefined);
			assert.equal(calls, 1);
		} finally {
			handle.dispose();
		}
	});
});
