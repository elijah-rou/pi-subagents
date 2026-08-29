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

export interface ResolveSubagentChildProfileOptions {
	signal?: AbortSignal;
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
	if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid child profile ${field}.`);
	return value.trim();
}

function normalizeSessionIdentities(value: string | readonly string[] | undefined): string[] {
	if (value === undefined) return [];
	const values = typeof value === "string" ? [value] : value;
	return [...new Set(values.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => validText(item, "sessionId", 4096)))];
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
	return { profile: validText(selection.profile, "profile", 64), model: validText(selection.model, "model", 256), ...(thinking ? { thinking } : {}), confidence: selection.confidence!, source };
}

export function registerSubagentChildProfileResolver(options: RegisterSubagentChildProfileResolverOptions): SubagentChildProfileResolverHandle {
	const sessionId = validText(options.sessionId, "sessionId", 4096);
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
	session.set(token, { source, resolve: options.resolve });
	let disposed = false;
	return {
		update(next) {
			if (disposed) throw new Error("Cannot update a disposed child profile resolver handle.");
			if (typeof next !== "function") throw new Error("Invalid child profile resolver; expected a function.");
			const current = store.get(sessionId);
			if (!current?.has(token)) throw new Error("Cannot update a stale child profile resolver handle.");
			current.set(token, { source, resolve: next });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			const current = store.get(sessionId);
			current?.delete(token);
			if (current?.size === 0) store.delete(sessionId);
		},
	};
}

export async function resolveSubagentChildProfile(sessionIdentity: string | readonly string[] | undefined, request: SubagentChildProfileRequest, options: ResolveSubagentChildProfileOptions = {}): Promise<ResolveSubagentChildProfileResult> {
	const identities = normalizeSessionIdentities(sessionIdentity);
	if (identities.length === 0) return { warnings: [] };
	const registrations = identities.flatMap((identity) => [...(registry().get(identity)?.values() ?? [])]);
	if (registrations.length === 0) return { warnings: [] };
	const normalizedRequest = normalizeRequest(request);
	const warnings: string[] = [];
	const deadlineAt = Date.now() + RESOLVER_TIMEOUT_MS;
	for (const { source, resolve } of registrations) {
		if (options.signal?.aborted) return { warnings: [...warnings, `Child profile resolution aborted; preserving static agent defaults.`] };
		const remainingMs = deadlineAt - Date.now();
		if (remainingMs <= 0) return { warnings: [...warnings, `Child profile resolution timed out after ${RESOLVER_TIMEOUT_MS}ms; preserving static agent defaults.`] };
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let abortListener: (() => void) | undefined;
		try {
			const expired = new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`timed out after aggregate ${RESOLVER_TIMEOUT_MS}ms deadline`)), remainingMs);
				timeout.unref?.();
			});
			const aborted = new Promise<never>((_resolve, reject) => {
				if (!options.signal) return;
				abortListener = () => reject(new Error("aborted"));
				options.signal.addEventListener("abort", abortListener, { once: true });
			});
			const value = await Promise.race([Promise.resolve(resolve(normalizedRequest)), expired, aborted]);
			if (value === null) continue;
			return { selection: normalizeSelection(value, source), warnings };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`Child profile resolver '${source}' failed open: ${message}`);
			if (options.signal?.aborted || message.startsWith("timed out after aggregate") || Date.now() >= deadlineAt) return { warnings };
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
			if (abortListener && options.signal) options.signal.removeEventListener("abort", abortListener);
		}
	}
	return { warnings };
}
