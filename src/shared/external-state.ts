import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type GeneratedNamespace = "artifacts" | "chain-runs";

export interface GeneratedProjectLocation {
	projectRoot: string;
	primaryDir: string;
	legacyDir: string;
	namespace: GeneratedNamespace;
}

interface GeneratedPathOptions {
	env?: NodeJS.ProcessEnv;
}

function canonicalExistingPath(value: string): string {
	return fs.realpathSync(path.resolve(value));
}

function pathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function canonicalProspectivePath(candidate: string): string {
	const absolute = path.resolve(candidate);
	let current = absolute;
	const unresolved: string[] = [];
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) throw new Error(`No existing ancestor for '${candidate}'.`);
		unresolved.unshift(path.basename(current));
		current = parent;
	}
	return path.join(canonicalExistingPath(current), ...unresolved);
}

function gitWorktreeRoot(candidate: string): string | undefined {
	let current = canonicalProspectivePath(candidate);
	while (!fs.existsSync(current)) current = path.dirname(current);
	for (;;) {
		if (fs.existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function assertOutsideGitWorktree(candidate: string): void {
	const canonicalCandidate = canonicalProspectivePath(candidate);
	const worktree = gitWorktreeRoot(canonicalCandidate);
	if (worktree && pathWithin(worktree, canonicalCandidate)) {
		throw new Error(`System-generated destination '${candidate}' is inside Git worktree '${worktree}'.`);
	}
}

function assertOwnedByCurrentUser(stat: fs.Stats, target: string): void {
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) throw new Error(`Private state path '${target}' has the wrong owner.`);
}

/** Reject every existing symlink component, not only the final destination. */
export function assertNoSymlinkPathComponents(target: string): void {
	const absolute = path.resolve(target);
	const root = path.parse(absolute).root;
	let current = root;
	for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Private state path '${current}' must not be a symlink.`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function verifyPrivateDirectory(target: string): void {
	const stat = fs.lstatSync(target);
	if (stat.isSymbolicLink()) throw new Error(`Private state path '${target}' must not be a symlink.`);
	if (!stat.isDirectory()) throw new Error(`Private state path '${target}' must be a directory.`);
	assertOwnedByCurrentUser(stat, target);
	if (process.platform !== "win32") {
		const mode = stat.mode & 0o777;
		if (mode !== 0o700) throw new Error(`Private state directory '${target}' must have mode 0700, found 0${mode.toString(8)}.`);
	}
}

export function ensurePrivateDirectory(target: string): void {
	const absolute = path.resolve(target);
	assertNoSymlinkPathComponents(absolute);
	assertOutsideGitWorktree(canonicalProspectivePath(absolute));
	if (!fs.existsSync(absolute)) fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
	const stat = fs.lstatSync(absolute);
	if (stat.isSymbolicLink()) throw new Error(`Private state path '${absolute}' must not be a symlink.`);
	if (!stat.isDirectory()) throw new Error(`Private state path '${absolute}' must be a directory.`);
	assertOwnedByCurrentUser(stat, absolute);
	if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700) {
		const directoryFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
		const fd = fs.openSync(absolute, directoryFlags);
		try {
			fs.fchmodSync(fd, 0o700);
		} finally {
			fs.closeSync(fd);
		}
	}
	verifyPrivateDirectory(absolute);
}

export function createPrivateDirectoryExclusive(target: string): void {
	const absolute = path.resolve(target);
	assertNoSymlinkPathComponents(absolute);
	assertOutsideGitWorktree(canonicalProspectivePath(absolute));
	ensurePrivateDirectory(path.dirname(absolute));
	try {
		fs.mkdirSync(absolute, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Private run directory '${absolute}' already exists; refusing stale or symlink collision.`);
		throw error;
	}
	verifyPrivateDirectory(absolute);
}

function xdgHome(kind: "data" | "state", env: NodeJS.ProcessEnv): string {
	const configured = (kind === "data" ? env.XDG_DATA_HOME : env.XDG_STATE_HOME)?.trim();
	if (configured && path.isAbsolute(configured)) return configured;
	return path.join(os.homedir(), ".local", kind === "data" ? "share" : "state");
}

function resolvePrivateApplicationRoot(kind: "data" | "state", env: NodeJS.ProcessEnv, prepareForWrite: boolean): string {
	const root = path.join(xdgHome(kind, env), "pi-subagents");
	assertOutsideGitWorktree(root);
	if (prepareForWrite) ensurePrivateDirectory(root);
	else if (fs.existsSync(root)) verifyPrivateDirectory(root);
	return root;
}

export function canonicalProjectKey(projectRoot: string): string {
	return createHash("sha256").update(canonicalExistingPath(projectRoot)).digest("hex");
}

export function resolveProjectStateLocation(
	projectRoot: string,
	namespace: GeneratedNamespace,
	legacyRelativePath: string,
	options: GeneratedPathOptions = {},
): GeneratedProjectLocation {
	const canonicalProjectRoot = canonicalExistingPath(projectRoot);
	const applicationRoot = resolvePrivateApplicationRoot("data", options.env ?? process.env, false);
	const primaryDir = path.join(applicationRoot, "projects", canonicalProjectKey(canonicalProjectRoot), namespace);
	assertOutsideGitWorktree(primaryDir);
	return {
		projectRoot: canonicalProjectRoot,
		primaryDir,
		legacyDir: path.resolve(canonicalProjectRoot, legacyRelativePath),
		namespace,
	};
}

function assertLegacyPathSafe(location: GeneratedProjectLocation): void {
	const relative = path.relative(location.projectRoot, location.legacyDir);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Legacy ${location.namespace} path escapes the project root.`);
	let current = location.projectRoot;
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		if (!fs.existsSync(current)) return;
		if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Legacy ${location.namespace} path '${current}' must not be a symlink.`);
	}
}

/** Resolve inspection reads. Legacy generated artifacts are fallback-only and are never moved or deleted. */
export function selectProjectStateReadDir(location: GeneratedProjectLocation): string {
	const primaryExists = fs.existsSync(location.primaryDir);
	const legacyExists = fs.existsSync(location.legacyDir);
	if (primaryExists && legacyExists) throw new Error(`Generated artifact conflict for ${location.namespace}: both '${location.primaryDir}' and legacy '${location.legacyDir}' exist.`);
	if (primaryExists) verifyPrivateDirectory(location.primaryDir);
	if (legacyExists) assertLegacyPathSafe(location);
	return primaryExists ? location.primaryDir : legacyExists ? location.legacyDir : location.primaryDir;
}

/** Resolve new generated writes. Existing project-local artifacts remain read-only fallback. */
export function prepareProjectStateWriteDir(location: GeneratedProjectLocation): string {
	const applicationRoot = path.dirname(path.dirname(path.dirname(location.primaryDir)));
	ensurePrivateDirectory(applicationRoot);
	const projectsRoot = path.join(applicationRoot, "projects");
	ensurePrivateDirectory(projectsRoot);
	ensurePrivateDirectory(path.dirname(location.primaryDir));
	ensurePrivateDirectory(location.primaryDir);
	return location.primaryDir;
}

export function resolvePrivateRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.XDG_RUNTIME_DIR?.trim();
	if (configured && path.isAbsolute(configured)) {
		const sharedRoot = path.resolve(configured);
		verifyPrivateDirectory(sharedRoot);
		const root = path.join(sharedRoot, "pi-subagents");
		assertOutsideGitWorktree(root);
		ensurePrivateDirectory(root);
		return root;
	}
	const root = path.join(resolvePrivateApplicationRoot("state", env, true), "runtime");
	ensurePrivateDirectory(root);
	return root;
}

export function ensurePrivateFile(filePath: string): void {
	const stat = fs.lstatSync(filePath);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Private state file '${filePath}' must be a regular file, not a symlink or special file.`);
	assertOwnedByCurrentUser(stat, filePath);
	if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) throw new Error(`Private state file '${filePath}' must have mode 0600.`);
}

function privateOpenFlags(baseFlags: number): number {
	return baseFlags | (fs.constants.O_NOFOLLOW ?? 0);
}

function assertSafeFinalDestination(filePath: string): void {
	try {
		const stat = fs.lstatSync(filePath);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Private state file '${filePath}' must be a regular file, not a symlink or special file.`);
		assertOwnedByCurrentUser(stat, filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/** Open a generated file without following the final path and force private permissions on existing files. */
export function openPrivateFile(filePath: string, flags: number): number {
	assertNoSymlinkPathComponents(filePath);
	assertSafeFinalDestination(filePath);
	const fd = fs.openSync(filePath, privateOpenFlags(flags), 0o600);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile()) throw new Error(`Private state file '${filePath}' must be a regular file.`);
		assertOwnedByCurrentUser(stat, filePath);
		fs.fchmodSync(fd, 0o600);
		return fd;
	} catch (error) {
		fs.closeSync(fd);
		throw error;
	}
}

export function writePrivateFile(filePath: string, content: string | Buffer): void {
	ensurePrivateDirectory(path.dirname(filePath));
	const fd = openPrivateFile(filePath, fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY);
	try {
		fs.writeFileSync(fd, content);
	} finally {
		fs.closeSync(fd);
	}
}

export function appendPrivateFile(filePath: string, content: string | Buffer): void {
	ensurePrivateDirectory(path.dirname(filePath));
	const fd = openPrivateFile(filePath, fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY);
	try {
		fs.writeFileSync(fd, content);
	} finally {
		fs.closeSync(fd);
	}
}
