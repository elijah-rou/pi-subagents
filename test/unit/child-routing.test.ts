import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChildRoutingInput, parseChildRoutingConfig, parseChildRoutingSuggestion } from "../../src/routing/child-routing.ts";

const raw = {
	enabled: true,
	threshold: 75,
	classifier: { model: "test/classifier", thinking: "off", timeoutMs: 5000 },
	profiles: {
		fast: { description: "bounded fast work", model: "test/fast", thinking: "low" },
		judge: { description: "high stakes judgment", model: "test/strong", thinking: "high" },
	},
};

describe("child routing", () => {
	it("strictly parses bounded configuration", () => {
		const config = parseChildRoutingConfig(raw)!;
		assert.equal(config.threshold, 75);
		assert.equal(config.profiles.judge?.thinking, "high");
		assert.throws(() => parseChildRoutingConfig({ ...raw, surprise: true }), /unsupported field/);
		assert.throws(() => parseChildRoutingConfig({ ...raw, threshold: 101 }), /0 to 100/);
	});

	it("accepts only exact classifier output", () => {
		const profiles = parseChildRoutingConfig(raw)!.profiles;
		assert.deepEqual(parseChildRoutingSuggestion('{"profile":"fast","confidence":80}', profiles), { profile: "fast", confidence: 80 });
		assert.equal(parseChildRoutingSuggestion('{"profile":"fast","confidence":80,"reason":"x"}', profiles), null);
		assert.equal(parseChildRoutingSuggestion('{"profile":"missing","confidence":80}', profiles), null);
	});

	it("bounds task and context input", () => {
		const input = buildChildRoutingInput({ agent: "worker", task: "x".repeat(20_000), cwd: "/tmp", parallel: true });
		assert.ok(Buffer.byteLength(input) < 16_384);
		assert.equal(JSON.parse(input).parallel, true);
	});
});
