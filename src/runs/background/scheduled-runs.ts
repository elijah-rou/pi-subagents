import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getProjectSubagentsDir } from "../../shared/artifacts.ts";
import { shortenPath } from "../../shared/formatters.ts";
import { getConfigDirName } from "../../shared/utils.ts";
import type { Details } from "../../shared/types.ts";
import { resolveGitRepositoryIdentity } from "../../workflows/chat-progress.ts";

/** Trusted-host readers retained temporarily for schedules written before Package 2b. */
export const LEGACY_SCHEDULE_READ_ACTIONS = ["schedule.list", "schedule.show", "schedule.history"] as const;

const SCHEDULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_LIST_RECORDS = 100;
const MAX_DIRECTORY_CANDIDATES = 256;
const MAX_HISTORY_RECORDS = 100;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_DETAILS_BYTES = 384 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;

type LegacyScheduleReadAction = typeof LEGACY_SCHEDULE_READ_ACTIONS[number];

export interface LegacyScheduleRecord {
	schemaVersion: 1;
	id: string;
	name: string;
	cwd: string;
	trigger: { kind: "once"; at: string; nextRunAt?: string } | { kind: "interval"; every: string; everyMs: number; anchorAt: string; nextRunAt: string };
	target: { workflowScript: string };
	overlap: "skip";
	catchUp: "none" | "latest";
	timeoutMs?: number;
	paused: boolean;
	createdAt: string;
	updatedAt: string;
	activeRunId?: string;
	lastRunId?: string;
	[key: string]: unknown;
}

export interface LegacyScheduleReadParams {
	action: LegacyScheduleReadAction;
	id?: string;
	cwd?: string;
}

export interface LegacyScheduleReader {
	handleToolCall(params: LegacyScheduleReadParams, ctx: ExtensionContext): Promise<AgentToolResult<Details>>;
}

export function isLegacyScheduleReadAction(action: unknown): action is LegacyScheduleReadAction {
	return typeof action === "string" && (LEGACY_SCHEDULE_READ_ACTIONS as readonly string[]).includes(action);
}

/** Preserves the project identity and path selection used by the removed schedule writer. */
export function scheduledRunStorePath(cwd: string, _sessionId?: string, root?: string): string {
	if (!root) return path.join(getProjectSubagentsDir(path.resolve(cwd)), "schedules");
	const projectKey = createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 20);
	return path.join(root, projectKey);
}

function normalizedComparisonPath(value: string): string {
	const absolute = path.resolve(value);
	if (process.platform !== "win32") return absolute;
	let normalized = absolute;
	try { normalized = fs.realpathSync.native(absolute); } catch {}
	normalized = normalized.replaceAll("/", "\\");
	if (normalized.startsWith("\\\\?\\UNC\\")) normalized = `\\\\${normalized.slice(8)}`;
	else if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4);
	normalized = path.win32.normalize(normalized).toLowerCase();
	if (normalized.length > 3) normalized = normalized.replace(/[\\]+$/, "");
	return normalized;
}

function pathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(normalizedComparisonPath(root), normalizedComparisonPath(candidate));
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
	return normalizedComparisonPath(left) === normalizedComparisonPath(right);
}

function resolveGitCommonDirForCheckout(checkoutRoot: string): string | undefined {
	const gitPath = path.join(checkoutRoot, ".git");
	try {
		const stat = fs.statSync(gitPath);
		if (stat.isDirectory()) return fs.realpathSync.native(gitPath);
		if (!stat.isFile()) return undefined;
		const match = /^gitdir:[ \t]*([^\r\n]+)$/i.exec(fs.readFileSync(gitPath, "utf-8").trim());
		return match?.[1] ? fs.realpathSync.native(path.resolve(checkoutRoot, match[1])) : undefined;
	} catch {
		return undefined;
	}
}

function resolveTrustedGitConfigRoot(checkoutRoot: string, commonDir: string): string | undefined {
	const resolvedCommonDir = resolveGitCommonDirForCheckout(checkoutRoot);
	if (!resolvedCommonDir || !samePath(resolvedCommonDir, commonDir)) return undefined;
	try {
		const resolved = fs.realpathSync.native(path.join(checkoutRoot, getConfigDirName()));
		return fs.statSync(resolved).isDirectory() && pathWithin(checkoutRoot, resolved) ? resolved : undefined;
	} catch {
		return undefined;
	}
}

function resolveSharedGitConfigRoot(projectCwd: string): string | undefined {
	const repository = resolveGitRepositoryIdentity(projectCwd);
	if (!repository) return undefined;
	let projectConfigRoot: string;
	try { projectConfigRoot = fs.realpathSync.native(path.join(projectCwd, getConfigDirName())); }
	catch { return undefined; }
	const result = spawnSync("git", ["-C", projectCwd, "worktree", "list", "--porcelain"], { encoding: "utf-8", windowsHide: true });
	if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
	for (const line of result.stdout.split(/\r?\n/)) {
		if (!line.startsWith("worktree ")) continue;
		let checkoutRoot: string;
		try { checkoutRoot = fs.realpathSync.native(line.slice("worktree ".length).trim()); }
		catch { continue; }
		const resolved = resolveTrustedGitConfigRoot(checkoutRoot, repository.commonDir);
		if (resolved && samePath(resolved, projectConfigRoot)) return resolved;
	}
	return undefined;
}

function assertReadableRoot(root: string, projectCwd: string | undefined): boolean {
	if (!fs.existsSync(root)) return false;
	const stat = fs.lstatSync(root);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Legacy schedule root '${root}' must be a real directory.`);
	if (!projectCwd) return true;
	const projectPath = fs.realpathSync.native(projectCwd);
	const rootPath = fs.realpathSync.native(root);
	if (pathWithin(projectPath, rootPath)) return true;
	const sharedGitConfigRoot = resolveSharedGitConfigRoot(projectCwd);
	if (sharedGitConfigRoot && pathWithin(sharedGitConfigRoot, rootPath)) return true;
	throw new Error(`Legacy project schedule root '${root}' resolves outside the real project.`);
}

function scheduleDirectory(root: string, id: string, projectCwd?: string): string {
	if (!SCHEDULE_ID.test(id)) throw new Error("Schedule id must be 1-64 characters and contain only letters, numbers, '.', '_', or '-'.");
	if (!assertReadableRoot(root, projectCwd)) return path.join(root, id);
	const directory = path.join(root, id);
	if (!fs.existsSync(directory)) return directory;
	const stat = fs.lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Legacy schedule path '${directory}' must be a real directory.`);
	const rootPath = fs.realpathSync.native(root);
	const directoryPath = fs.realpathSync.native(directory);
	if (!samePath(directoryPath, path.join(rootPath, id))) throw new Error(`Legacy schedule path '${directory}' escapes the project schedule root.`);
	return directory;
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function readJson(file: string, label: string, maxBytes: number): unknown {
	let before: fs.Stats;
	try { before = fs.lstatSync(file); }
	catch (error) { throw new Error(`Failed to inspect ${label} '${file}': ${error instanceof Error ? error.message : String(error)}`); }
	if (before.isSymbolicLink()) throw new Error(`${label} '${file}' must not be a symbolic link.`);
	if (!before.isFile()) throw new Error(`${label} '${file}' must be a regular file.`);
	const noFollow = fs.constants.O_NOFOLLOW ?? 0;
	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
		const opened = fs.fstatSync(descriptor);
		if (!opened.isFile()) throw new Error(`${label} '${file}' must be a regular file.`);
		if (!sameFile(before, opened)) throw new Error(`${label} '${file}' changed before it could be read safely.`);
		const chunks: Buffer[] = [];
		let bytes = 0;
		while (bytes <= maxBytes) {
			const chunk = Buffer.allocUnsafe(Math.min(16 * 1024, maxBytes + 1 - bytes));
			const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
			if (count === 0) break;
			chunks.push(chunk.subarray(0, count));
			bytes += count;
		}
		if (bytes > maxBytes) throw new Error(`${label} '${file}' exceeds the compatibility read bound of ${maxBytes} bytes.`);
		const after = fs.lstatSync(file);
		if (after.isSymbolicLink() || !after.isFile() || !sameFile(opened, after)) throw new Error(`${label} '${file}' changed while it was being read.`);
		return JSON.parse(Buffer.concat(chunks, bytes).toString("utf-8"));
	} catch (error) {
		throw new Error(`Failed to read ${label} '${file}': ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
}

function parseSchedule(value: unknown, file: string): LegacyScheduleRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Schedule record '${file}' must be a JSON object.`);
	const record = value as Partial<LegacyScheduleRecord>;
	if (record.schemaVersion !== 1 || typeof record.id !== "string" || typeof record.name !== "string" || typeof record.cwd !== "string" || typeof record.createdAt !== "string" || typeof record.updatedAt !== "string" || typeof record.paused !== "boolean") throw new Error(`Schedule record '${file}' has invalid required fields.`);
	if (!SCHEDULE_ID.test(record.id) || !record.trigger || typeof record.trigger !== "object" || !record.target || typeof record.target !== "object" || typeof record.target.workflowScript !== "string") throw new Error(`Schedule record '${file}' has invalid trigger or target.`);
	if (record.overlap !== "skip" || (record.catchUp !== "none" && record.catchUp !== "latest")) throw new Error(`Schedule record '${file}' has unsupported policy fields.`);
	if (record.trigger.kind === "once") {
		if (typeof record.trigger.at !== "string" || (record.trigger.nextRunAt !== undefined && typeof record.trigger.nextRunAt !== "string")) throw new Error(`Schedule record '${file}' has an invalid one-shot trigger.`);
	} else if (record.trigger.kind === "interval") {
		if (typeof record.trigger.every !== "string" || typeof record.trigger.everyMs !== "number" || typeof record.trigger.anchorAt !== "string" || typeof record.trigger.nextRunAt !== "string") throw new Error(`Schedule record '${file}' has an invalid interval trigger.`);
	} else throw new Error(`Schedule record '${file}' has an unsupported trigger.`);
	return record as LegacyScheduleRecord;
}

function readSchedule(root: string, id: string, projectCwd?: string): LegacyScheduleRecord | undefined {
	const file = path.join(scheduleDirectory(root, id, projectCwd), "schedule.json");
	try { fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	const record = parseSchedule(readJson(file, "schedule record", MAX_RECORD_BYTES), file);
	if (record.id !== id) throw new Error(`Schedule record '${file}' id does not match its directory.`);
	return record;
}

function boundedText(value: string): string {
	const buffer = Buffer.from(value);
	if (buffer.length <= MAX_TEXT_BYTES) return value;
	return `${buffer.subarray(0, MAX_TEXT_BYTES - 32).toString("utf-8").replace(/\uFFFD$/u, "")}\n[output truncated]`;
}

function displayField(value: unknown, maxLength: number): string {
	return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, maxLength);
}

function textResult(text: string, schedules?: unknown[], runs?: unknown[], isError = false): AgentToolResult<Details> {
	return {
		content: [{ type: "text", text: boundedText(text) }],
		...(isError ? { isError: true } : {}),
		details: { mode: "management", results: [], schedules: { ...(schedules ? { records: schedules } : {}), ...(runs ? { runs } : {}) } },
	};
}

function listRecords(root: string, projectCwd?: string): { records: LegacyScheduleRecord[]; skipped: number; omitted: number; scanBoundReached: boolean } {
	if (!assertReadableRoot(root, projectCwd)) return { records: [], skipped: 0, omitted: 0, scanBoundReached: false };
	const directory = fs.opendirSync(root);
	const ids: string[] = [];
	let scanBoundReached = false;
	try {
		for (let inspected = 0; inspected <= MAX_DIRECTORY_CANDIDATES; inspected++) {
			const entry = directory.readSync();
			if (!entry) break;
			if (inspected === MAX_DIRECTORY_CANDIDATES) { scanBoundReached = true; break; }
			if (entry.isDirectory() && SCHEDULE_ID.test(entry.name)) ids.push(entry.name);
		}
	} finally {
		directory.closeSync();
	}
	ids.sort();
	const records: LegacyScheduleRecord[] = [];
	let detailsBytes = 0;
	let skipped = 0;
	let omitted = 0;
	for (const id of ids) {
		if (records.length >= MAX_LIST_RECORDS) { omitted += 1; continue; }
		try {
			const record = readSchedule(root, id, projectCwd);
			if (!record) continue;
			const recordBytes = Buffer.byteLength(JSON.stringify(record));
			if (detailsBytes + recordBytes > MAX_DETAILS_BYTES) { omitted += 1; continue; }
			records.push(record);
			detailsBytes += recordBytes;
		} catch {
			skipped += 1;
		}
	}
	return { records, skipped, omitted, scanBoundReached };
}

export function createLegacyScheduleReader(options: { storeRoot?: string }): LegacyScheduleReader {
	return {
		async handleToolCall(params, ctx) {
			try {
				if (!isLegacyScheduleReadAction(params.action)) return textResult(`Unknown legacy schedule reader action: ${params.action}`, undefined, undefined, true);
				const cwd = path.resolve(params.cwd ?? ctx.cwd);
				const root = scheduledRunStorePath(cwd, undefined, options.storeRoot);
				const projectCwd = options.storeRoot === undefined ? cwd : undefined;
				if (params.action === "schedule.list") {
					const { records, skipped, omitted, scanBoundReached } = listRecords(root, projectCwd);
					const suffix = [skipped ? `Skipped ${skipped} unreadable legacy schedule records within the bounded scan.` : "", omitted ? `Omitted ${omitted} readable records beyond aggregate output bounds.` : "", scanBoundReached ? `Candidate scan stopped at the ${MAX_DIRECTORY_CANDIDATES}-entry bound; additional directory entries were not inspected.` : ""].filter(Boolean);
					if (!records.length) return textResult(["No legacy project schedules.", ...suffix].join("\n"), []);
					return textResult([`Legacy project schedules: ${records.length}`, ...records.map((record) => `- ${displayField(record.id, 64)} | ${record.paused ? "paused" : record.activeRunId ? "historically running" : "inactive"} | ${displayField(record.trigger.nextRunAt ?? "no next run", 80)} | ${displayField(record.name, 160)}`), ...suffix].join("\n"), records);
				}
				const id = params.id?.trim();
				if (!id) throw new Error(`${params.action} requires id.`);
				const schedule = readSchedule(root, id, projectCwd);
				if (!schedule) throw new Error(`Legacy schedule '${id}' not found.`);
				if (params.action === "schedule.show") {
					return textResult([`Legacy schedule: ${displayField(schedule.id, 64)}`, `Name: ${displayField(schedule.name, 160)}`, `Recorded state: ${schedule.paused ? "paused" : schedule.activeRunId ? "running when scheduling stopped" : "inactive"}`, `CWD: ${displayField(shortenPath(displayField(schedule.cwd, 1024)), 240)}`, `Recorded next run: ${displayField(schedule.trigger.nextRunAt ?? "none", 80)}`].join("\n"), [schedule]);
				}
				const file = path.join(scheduleDirectory(root, id, projectCwd), "history.json");
				try { fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return textResult(`No legacy runs recorded for schedule ${displayField(id, 64)}.`, [schedule], []); throw error; }
				const value = readJson(file, "schedule history", MAX_HISTORY_BYTES) as { schemaVersion?: unknown; runs?: unknown };
				if (value?.schemaVersion !== 1 || !Array.isArray(value.runs)) throw new Error(`Schedule history '${file}' has invalid fields.`);
				const runs: unknown[] = [];
				let detailsBytes = Buffer.byteLength(JSON.stringify(schedule));
				let omitted = 0;
				for (const run of value.runs) {
					if (runs.length >= MAX_HISTORY_RECORDS) { omitted += 1; continue; }
					const runBytes = Buffer.byteLength(JSON.stringify(run));
					if (detailsBytes + runBytes > MAX_DETAILS_BYTES) { omitted += 1; continue; }
					runs.push(run);
					detailsBytes += runBytes;
				}
				const suffix = omitted ? `Omitted ${omitted} history entries beyond entry or aggregate output bounds.` : "";
				return textResult(runs.length ? [`Legacy schedule history: ${displayField(id, 64)}`, ...runs.map((run, index) => {
					const item = run && typeof run === "object" ? run as Record<string, unknown> : {};
					return `- ${displayField(item.id ?? index, 80)} | ${displayField(item.state ?? "unknown", 40)} | ${displayField(item.plannedAt ?? "unknown", 80)}`;
				}), suffix].filter(Boolean).join("\n") : [`No legacy runs recorded for schedule ${displayField(id, 64)}.`, suffix].filter(Boolean).join("\n"), [schedule], runs);
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), undefined, undefined, true);
			}
		},
	};
}
