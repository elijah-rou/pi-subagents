import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { classifyChildProfile } from "../../src/routing/child-routing.ts";
import { parseChildRoutingConfig } from "../../src/routing/child-routing-config.ts";

function model(provider: string, id: string): Model<any> {
	return { id, name: id, api: "faux", provider, baseUrl: "https://example.invalid", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4_096 };
}

function config(modelId = "custom/router:preview") {
	return parseChildRoutingConfig({
		enabled: true,
		threshold: 75,
		classifier: { model: modelId, reasoningEffort: "minimal", reasoningSummary: "concise", textVerbosity: "medium", serviceTier: "priority", timeoutMs: 500 },
		profiles: { standard: { description: "standard work", model: "custom/child", thinking: "high" } },
	})!;
}

function responseStream(text: string) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage(text, { stopReason: "stop" }) }));
	return stream;
}

function ctx(input: { classifier: Model<any>; auth?: () => Promise<any>; stream?: StreamFn }) {
	return {
		cwd: "/repo",
		model: { provider: "custom", id: "parent" },
		modelRegistry: {
			getAvailable: () => [input.classifier],
			find: (provider: string, id: string) => provider === input.classifier.provider && id === input.classifier.id ? input.classifier : undefined,
			getApiKeyAndHeaders: input.auth ?? (async () => ({ ok: true as const, apiKey: "key", headers: { "x-auth": "yes" }, env: { ROUTER_ENV: "1" } })),
			getRegisteredProviderConfig: () => input.stream ? { api: input.classifier.api, streamSimple: input.stream } : undefined,
		},
	} as never;
}

const request = { agent: "worker", task: "implement", cwd: "/repo", parallel: false } as const;

describe("child routing classifier transport", () => {
	it("preserves colon-bearing ids, strips only known thinking suffixes, and forwards custom transport options", async () => {
		const classifier = model("custom", "router:preview");
		const calls: Array<{ model: Model<any>; context: Context; options?: SimpleStreamOptions & Record<string, unknown> }> = [];
		const stream: StreamFn = (nextModel, context, options) => {
			calls.push({ model: nextModel, context, options: options as SimpleStreamOptions & Record<string, unknown> });
			return responseStream('{"profile":"standard","confidence":90}');
		};
		const selected = await classifyChildProfile(ctx({ classifier, stream }), config("custom/router:preview:low"), request);
		assert.equal(selected?.profile, "standard");
		assert.equal(calls[0]?.model.id, "router:preview");
		assert.equal(calls[0]?.options?.reasoningEffort, "minimal");
		assert.equal(calls[0]?.options?.reasoningSummary, "concise");
		assert.equal(calls[0]?.options?.textVerbosity, "medium");
		assert.equal(calls[0]?.options?.serviceTier, "priority");
		assert.equal(calls[0]?.options?.headers?.["x-auth"], "yes");
		assert.equal(calls[0]?.options?.env?.ROUTER_ENV, "1");
		assert.ok(calls[0]?.options?.signal instanceof AbortSignal);
	});

	it("enforces timeout while auth/header resolution is pending", async () => {
		const classifier = model("custom", "router:preview");
		const routing = config();
		routing.classifier.timeoutMs = 25;
		await assert.rejects(
			classifyChildProfile(ctx({ classifier, auth: () => new Promise(() => {}) }), routing, request),
			/timed out after 25ms/,
		);
	});

	it("enforces the same timeout while the custom provider stream is pending", async () => {
		const classifier = model("custom", "router:preview");
		const routing = config();
		routing.classifier.timeoutMs = 25;
		const stream: StreamFn = () => createAssistantMessageEventStream();
		await assert.rejects(classifyChildProfile(ctx({ classifier, stream }), routing, request), /timed out after 25ms/);
	});

	it("propagates caller abort while auth/header resolution is pending", async () => {
		const classifier = model("custom", "router:preview");
		const controller = new AbortController();
		const pending = classifyChildProfile(ctx({ classifier, auth: () => new Promise(() => {}) }), config(), request, controller.signal);
		controller.abort(new Error("caller cancelled classifier"));
		await assert.rejects(pending, /caller cancelled classifier/);
	});
});
