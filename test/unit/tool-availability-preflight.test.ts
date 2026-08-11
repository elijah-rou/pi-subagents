import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRequiredChildTools } from "../../src/runs/shared/tool-availability.ts";

describe("child tool availability preflight", () => {
	it("distinguishes available, deferred, and definitely missing tools", () => {
		assert.deepEqual(classifyRequiredChildTools({
			required: ["read", "structured_output", "custom_search", "github_search", "typo_tool"],
			internal: ["structured_output"],
			mcp: ["github_search"],
			providerToolNames: ["custom_search"],
			ambientExtensionsEnabled: false,
		}), {
			available: ["read", "structured_output"],
			deferred: ["custom_search", "github_search"],
			definiteMissing: ["typo_tool"],
		});
	});

	it("defers unknown tools when ambient child extensions may provide them", () => {
		assert.deepEqual(classifyRequiredChildTools({
			required: ["ambient_search"],
			ambientExtensionsEnabled: true,
		}), {
			available: [],
			deferred: ["ambient_search"],
			definiteMissing: [],
		});
	});
});
