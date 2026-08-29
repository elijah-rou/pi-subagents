import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensurePrivateDirectory, openPrivateFile } from "../../src/shared/private-state.ts";

describe("private runtime state", () => {
	it("creates private directories and files", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-private-state-"));
		try {
			const directory = path.join(root, "runtime", "run");
			ensurePrivateDirectory(directory);
			const descriptor = openPrivateFile(path.join(directory, "status.json"), fs.constants.O_CREAT | fs.constants.O_WRONLY);
			fs.closeSync(descriptor);
			if (process.platform !== "win32") {
				assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
				assert.equal(fs.statSync(path.join(directory, "status.json")).mode & 0o777, 0o600);
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("secures the private root and every descendant before writes", { skip: process.platform === "win32" }, () => {
		const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pi-private-state-"));
		try {
			const root = path.join(parent, "app");
			const ancestor = path.join(root, "async");
			fs.mkdirSync(ancestor, { recursive: true, mode: 0o755 });
			ensurePrivateDirectory(path.join(ancestor, "run"), { privateRoot: root });
			assert.equal(fs.statSync(root).mode & 0o777, 0o700);
			assert.equal(fs.statSync(ancestor).mode & 0o777, 0o700);
			assert.equal(fs.statSync(path.join(ancestor, "run")).mode & 0o777, 0o700);
		} finally {
			fs.rmSync(parent, { recursive: true, force: true });
		}
	});

	it("rejects symlink path components", { skip: process.platform === "win32" }, () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-private-state-"));
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-private-state-outside-"));
		try {
			fs.symlinkSync(outside, path.join(root, "linked"), "dir");
			assert.throws(() => ensurePrivateDirectory(path.join(root, "linked", "run")), /must not be a symlink/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});
});
