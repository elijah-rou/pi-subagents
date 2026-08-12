export const SUBAGENT_CHILD_PROFILE_RESOLVER_VERSION = 1 as const;
export const SUBAGENT_CHILD_PROFILE_RESOLVER_REGISTRY_KEY = "pi-subagents.child-profile-resolver.v1";

export interface SubagentChildProfileRequest {
	agent: string;
	task: string;
	cwd: string;
	parallel: boolean;
	context?: "fresh" | "fork";
	parentModel?: { provider: string; id: string };
}

export interface SubagentChildProfileSelection {
	profile: string;
	model: string;
	thinking?: string;
	confidence: number;
}

export interface ResolvedSubagentChildProfileSelection extends SubagentChildProfileSelection {
	source: string;
}

export type SubagentChildProfileResolver = (request: SubagentChildProfileRequest) => Promise<SubagentChildProfileSelection | null> | SubagentChildProfileSelection | null;

export interface RegisterSubagentChildProfileResolverOptions {
	sessionId: string;
	source: string;
	resolve: SubagentChildProfileResolver;
}

export interface SubagentChildProfileResolverHandle {
	update(resolve: SubagentChildProfileResolver): void;
	dispose(): void;
}

export interface ResolveSubagentChildProfileResult {
	selection?: ResolvedSubagentChildProfileSelection;
	warnings: string[];
}

type Registration = { source: string; resolve: SubagentChildProfileResolver };
type Registry = Map<string, Map<symbol, Registration>>;
const MAX_RESOLVER_SESSIONS = 256;
const MAX_RESOLVERS_PER_SESSION = 8;
const RESOLVER_TIMEOUT_MS = 6_000;

function registry(): Registry {
	const key = Symbol.for(SUBAGENT_CHILD_PROFILE_RESOLVER_REGISTRY_KEY);
	const store = globalThis as typeof globalThis & { [key: symbol]: unknown };
	const existing = store[key];
	if (existing instanceof Map) return existing as Registry;
	const created: Registry = new Map();
	store[key] = created;
	return created;
}

function validText(value: unknown, field: string, maxLength: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new Error(`Invalid child profile ${field}.`);
	}
	return value.trim();
}

function normalizeRequest(request: SubagentChildProfileRequest): SubagentChildProfileRequest {
	if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid child profile request.");
	return {
		agent: validText(request.agent, "request agent", 128),
		task: typeof request.task === "string" ? request.task.slice(0, 16_384) : "",
		cwd: validText(request.cwd, "request cwd", 4096),
		parallel: request.parallel === true,
		...(request.context ? { context: request.context } : {}),
		...(request.parentModel ? { parentModel: { provider: validText(request.parentModel.provider, "parent provider", 128), id: validText(request.parentModel.id, "parent model", 256) } } : {}),
	};
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function normalizeSelection(value: unknown, source: string): ResolvedSubagentChildProfileSelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object or null");
	const selection = value as Partial<SubagentChildProfileSelection>;
	if (!Number.isSafeInteger(selection.confidence) || selection.confidence! < 0 || selection.confidence! > 100) throw new Error("confidence must be an integer from 0 to 100");
	const thinking = selection.thinking === undefined ? undefined : validText(selection.thinking, "thinking", 32);
	if (thinking !== undefined && !THINKING_LEVELS.has(thinking)) throw new Error("thinking is not a supported level");
	return {
		profile: validText(selection.profile, "profile", 64),
		model: validText(selection.model, "model", 256),
		...(thinking ? { thinking } : {}),
		confidence: selection.confidence!,
		source,
	};
}

export function registerSubagentChildProfileResolver(options: RegisterSubagentChildProfileResolverOptions): SubagentChildProfileResolverHandle {
	const sessionId = validText(options.sessionId, "sessionId", 256);
	const source = validText(options.source, "source", 256);
	if (typeof options.resolve !== "function") throw new Error("Invalid child profile resolver; expected a function.");
	const token = Symbol(source);
	const store = registry();
	let session = store.get(sessionId);
	if (!session) {
		if (store.size >= MAX_RESOLVER_SESSIONS) throw new Error(`At most ${MAX_RESOLVER_SESSIONS} child profile resolver sessions are allowed.`);
		session = new Map();
		store.set(sessionId, session);
	}
	if (session.size >= MAX_RESOLVERS_PER_SESSION) throw new Error(`At most ${MAX_RESOLVERS_PER_SESSION} child profile resolvers are allowed per session.`);
	let resolver = options.resolve;
	session.set(token, { source, resolve: resolver });
	let disposed = false;
	return {
		update(next) {
			if (disposed) throw new Error("Cannot update a disposed child profile resolver handle.");
			if (typeof next !== "function") throw new Error("Invalid child profile resolver; expected a function.");
			resolver = next;
			session!.set(token, { source, resolve: resolver });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			session!.delete(token);
			if (session!.size === 0) store.delete(sessionId);
		},
	};
}

export async function resolveSubagentChildProfile(sessionId: string | undefined, request: SubagentChildProfileRequest): Promise<ResolveSubagentChildProfileResult> {
	if (!sessionId) return { warnings: [] };
	const registrations = registry().get(sessionId);
	if (!registrations || registrations.size === 0) return { warnings: [] };
	const normalizedRequest = normalizeRequest(request);
	const warnings: string[] = [];
	for (const { source, resolve } of registrations.values()) {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const expired = new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`timed out after ${RESOLVER_TIMEOUT_MS}ms`)), RESOLVER_TIMEOUT_MS);
				timeout.unref?.();
			});
			const value = await Promise.race([Promise.resolve(resolve(normalizedRequest)), expired]);
			if (value === null) continue;
			return { selection: normalizeSelection(value, source), warnings };
		} catch (error) {
			warnings.push(`Child profile resolver '${source}' failed open: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}
	return { warnings };
}
