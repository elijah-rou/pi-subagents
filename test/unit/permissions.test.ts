import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	decodePermissionRules,
	encodePermissionRules,
	permissionDecision,
	resolvePermissionRules,
	validatePermissionConfig,
	validatePermissionRules,
} from "../../src/runs/shared/permissions.ts";

describe("native child permissions", () => {
	it("defaults every unconfigured tool and bash to pass-through", () => {
		assert.equal(permissionDecision(undefined, "write"), "allow");
		assert.equal(permissionDecision({ write: "deny" }, "unknown_tool"), "allow");
		assert.equal(permissionDecision({ write: "deny" }, "bash"), "allow");
		assert.equal(resolvePermissionRules(), undefined);
	});

	it("merges explicit global and agent rules while removing explicit allow rules", () => {
		assert.deepEqual(resolvePermissionRules(
			{ rules: { write: "ask", edit: "deny" } },
			{ write: "allow", read: "deny" },
		), { edit: "deny", read: "deny" });
	});

	it("rejects bash and coordination-tool rules", () => {
		assert.throws(() => validatePermissionRules({ bash: "ask" }, "permissions"), /pi-guard/);
		assert.throws(() => validatePermissionRules({ contact_supervisor: "deny" }, "permissions"), /reserved for child coordination/);
		assert.throws(() => validatePermissionConfig({ rules: { write: "sometimes" } }), /allow, ask, or deny/);
	});

	it("round-trips explicit non-allow rules", () => {
		const encoded = encodePermissionRules({ write: "ask" });
		assert.deepEqual(decodePermissionRules(encoded), { write: "ask" });
	});
});
