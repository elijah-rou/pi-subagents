import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChildRoutingInput, buildChildRoutingSystemPrompt, latestAssistantText, parseChildRoutingConfig, parseChildRoutingSuggestion } from "../../src/routing/child-routing.ts";

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
		assert.throws(
			() => parseChildRoutingConfig({ ...raw, profiles: { invalid: { description: "conflicting thinking", model: "test/child:low", thinking: "high" } } }),
			/must not include a thinking suffix when profile\.thinking is set/,
		);
		assert.equal(parseChildRoutingConfig({ ...raw, profiles: { valid: { description: "model-owned thinking", model: "test/child:low" } } })?.profiles.valid?.model, "test/child:low");
	});

	it("accepts only exact classifier output", () => {
		const profiles = parseChildRoutingConfig(raw)!.profiles;
		assert.deepEqual(parseChildRoutingSuggestion('{"profile":"fast","confidence":80}', profiles), { profile: "fast", confidence: 80 });
		assert.equal(parseChildRoutingSuggestion('{"profile":"fast","confidence":80,"reason":"x"}', profiles), null);
		assert.equal(parseChildRoutingSuggestion('{"profile":"missing","confidence":80}', profiles), null);
		assert.equal(parseChildRoutingSuggestion('{"profile":"constructor","confidence":80}', profiles), null);
	});

	it("selects the latest non-empty text-bearing assistant message", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: '{"profile":"fast","confidence":90}' }] },
			{ role: "assistant", content: [{ type: "toolCall", name: "unused" }] },
			{ role: "assistant", content: [{ type: "text", text: "   " }] },
		];
		assert.equal(latestAssistantText(messages), '{"profile":"fast","confidence":90}');
	});

	it("bounds maximum Unicode profile and model fields plus task and context input", () => {
		const profiles = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`p${index}`, { description: "界".repeat(240), model: `test/${"界".repeat(240)}` }]));
		const config = parseChildRoutingConfig({ ...raw, classifier: { ...raw.classifier, model: `test/${"界".repeat(240)}` }, profiles })!;
		const input = buildChildRoutingInput({ agent: "🧠".repeat(1_000), task: "🧠".repeat(20_000), cwd: `/${"🧠".repeat(1_000)}`, parallel: true, parentModel: { provider: "🧠".repeat(1_000), id: "🧠".repeat(1_000) } }, config);
		assert.ok(Buffer.byteLength(input) <= 16_384);
		assert.equal(JSON.parse(input).parallel, true);
		assert.deepEqual(Object.keys(JSON.parse(input).profiles), Object.keys(profiles));
		assert.doesNotMatch(buildChildRoutingSystemPrompt(), /bounded fast work|high stakes judgment/);
	});
});
