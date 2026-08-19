import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChildRoutingInput, buildChildRoutingSystemPrompt, parseChildRoutingConfig, parseChildRoutingSuggestion } from "../../src/routing/child-routing.ts";

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
		const transport = parseChildRoutingConfig({ ...raw, classifier: { provider: "test", model: "classifier", reasoningEffort: "minimal", reasoningSummary: "concise", textVerbosity: "medium", serviceTier: "priority", timeoutMs: 1000 } })!;
		assert.equal(transport.classifier.model, "test/classifier");
		assert.equal(transport.classifier.thinking, "minimal");
		assert.equal(transport.classifier.serviceTier, "priority");
		assert.throws(() => parseChildRoutingConfig({ ...raw, surprise: true }), /unsupported field/);
		assert.throws(() => parseChildRoutingConfig({ ...raw, threshold: 101 }), /0 to 100/);
	});

	it("accepts only exact classifier output", () => {
		const profiles = parseChildRoutingConfig(raw)!.profiles;
		assert.deepEqual(parseChildRoutingSuggestion('{"profile":"fast","confidence":80}', profiles), { profile: "fast", confidence: 80 });
		assert.equal(parseChildRoutingSuggestion('{"profile":"fast","confidence":80,"reason":"x"}', profiles), null);
		assert.equal(parseChildRoutingSuggestion('{"profile":"missing","confidence":80}', profiles), null);
		assert.equal(parseChildRoutingSuggestion('{"profile":"constructor","confidence":80}', profiles), null);
	});

	it("bounds task and context input", () => {
		const config = parseChildRoutingConfig(raw)!;
		const input = buildChildRoutingInput({ agent: "worker", task: "🧠".repeat(20_000), cwd: "/tmp", parallel: true }, config);
		assert.ok(Buffer.byteLength(input) <= 16_384);
		assert.equal(JSON.parse(input).parallel, true);
		assert.deepEqual(Object.keys(JSON.parse(input).profiles), ["fast", "judge"]);
		assert.doesNotMatch(buildChildRoutingSystemPrompt(), /bounded fast work|high stakes judgment/);
	});
});
