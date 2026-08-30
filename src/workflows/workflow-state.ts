import * as fs from "node:fs";
import * as path from "node:path";
import { writePrivateAtomicJson } from "../shared/atomic-json.ts";
import { withPrivateFileLock } from "../shared/private-file-lock.ts";
import { assertWorkflowJsonValue } from "./scripted-workflow.ts";

const STATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const WORKFLOW_STATE_MAX_BYTES = 256 * 1024;
export interface WorkflowState {
	path: string;
	get(key: string): unknown;
	set(key: string, value: unknown): void;
}

export function removeSettledWorkflowState(filePath: string, state: string): boolean {
	if (!["complete", "failed", "stopped"].includes(state)) return false;
	if (path.basename(filePath) !== "workflow-state.json") {
		throw new Error("settled async workflow state cleanup requires the owned workflow-state.json file.");
	}
	fs.rmSync(filePath, { force: true });
	return true;
}

function validateStateKey(value: unknown): string {
	if (typeof value !== "string" || !STATE_KEY_PATTERN.test(value)) {
		throw new Error("state key must be 1-128 characters using letters, numbers, '.', '_' or '-', and start with a letter or number.");
	}
	return value;
}

/** Workflow-owned state is one caller-owned file under its lifecycle or artifact root. */
export function createWorkflowState(filePath: string): WorkflowState {
	if (!path.isAbsolute(filePath)) throw new Error("workflow state path must be absolute.");
	const rootPath = path.parse(filePath).root;
	if (path.normalize(filePath) === rootPath) throw new Error("workflow state path cannot be a filesystem root.");
	try {
		if (fs.statSync(filePath).isDirectory()) throw new Error("workflow state path cannot be an existing directory.");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	let loaded = false;
	let values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

	const readStateFile = (): Record<string, unknown> => {
		let raw: string;
		try {
			raw = fs.readFileSync(filePath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null) as Record<string, unknown>;
			throw new Error(`Failed to read workflow state '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
		}
		const bytes = Buffer.byteLength(raw);
		if (bytes > WORKFLOW_STATE_MAX_BYTES) throw new Error(`Workflow state file '${filePath}' exceeds the 256 KiB limit (${bytes} bytes).`);
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root must be a JSON object");
			assertWorkflowJsonValue(parsed, "workflow state");
			return Object.assign(Object.create(null) as Record<string, unknown>, parsed);
		} catch (error) {
			throw new Error(`Invalid workflow state file '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const load = (): Record<string, unknown> => {
		if (loaded) return values;
		values = readStateFile();
		loaded = true;
		return values;
	};

	return {
		path: filePath,
		get(key) {
			const validKey = validateStateKey(key);
			const current = load();
			return Object.hasOwn(current, validKey) ? current[validKey] : undefined;
		},
		set(key, value) {
			const validKey = validateStateKey(key);
			assertWorkflowJsonValue(value, `state.set('${validKey}') value`);
			withPrivateFileLock(filePath, () => {
				const next = Object.assign(Object.create(null) as Record<string, unknown>, readStateFile(), { [validKey]: value });
				const bytes = Buffer.byteLength(JSON.stringify(next, null, 2));
				if (bytes > WORKFLOW_STATE_MAX_BYTES) throw new Error(`Workflow state exceeds the 256 KiB limit (${bytes} bytes; maximum ${WORKFLOW_STATE_MAX_BYTES} bytes).`);
				writePrivateAtomicJson(filePath, next);
				values = next;
				loaded = true;
			}, { label: "workflow state" });
		},
	};
}
