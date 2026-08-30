import * as fs from "node:fs";
import * as path from "node:path";

function assertOwnedByCurrentUser(stat: fs.Stats, target: string): void {
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) throw new Error(`Private state path '${target}' has the wrong owner.`);
}

function canonicalizeThroughExistingAncestor(target: string): string {
	const absolute = path.resolve(target);
	const missing: string[] = [];
	let existing = absolute;
	while (!fs.existsSync(existing)) {
		missing.unshift(path.basename(existing));
		const parent = path.dirname(existing);
		if (parent === existing) break;
		existing = parent;
	}
	return path.join(fs.realpathSync.native(existing), ...missing);
}

export function assertNoSymlinkPathComponents(target: string): void {
	const absolute = path.resolve(target);
	const root = path.parse(absolute).root;
	let current = root;
	for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			if (fs.lstatSync(current).isSymbolicLink()) {
				const canonicalMacVarAlias = process.platform === "darwin" && current === "/var" && fs.realpathSync.native(current) === "/private/var";
				if (!canonicalMacVarAlias) throw new Error(`Private state path '${current}' must not be a symlink.`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

function securePrivateDirectory(target: string): void {
	const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
	const descriptor = fs.openSync(target, flags);
	try {
		const stat = fs.fstatSync(descriptor);
		const pathStat = fs.lstatSync(target);
		if (!stat.isDirectory() || pathStat.isSymbolicLink() || !pathStat.isDirectory()) throw new Error(`Private state path '${target}' must be a directory.`);
		if (pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) throw new Error(`Private state path '${target}' changed while it was opened.`);
		assertOwnedByCurrentUser(stat, target);
		if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o700);
	} finally {
		fs.closeSync(descriptor);
	}
}

export function ensurePrivateDirectory(target: string, options: { privateRoot?: string } = {}): void {
	const absolute = path.resolve(target);
	const privateRoot = path.resolve(options.privateRoot ?? absolute);
	const canonicalPrivateRoot = canonicalizeThroughExistingAncestor(privateRoot);
	const canonicalAbsolute = canonicalizeThroughExistingAncestor(absolute);
	const canonicalRelative = path.relative(canonicalPrivateRoot, canonicalAbsolute);
	if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) throw new Error(`Private state path '${absolute}' escapes private root '${privateRoot}'.`);
	assertNoSymlinkPathComponents(absolute);
	assertNoSymlinkPathComponents(privateRoot);
	fs.mkdirSync(canonicalPrivateRoot, { recursive: true, mode: 0o700 });
	securePrivateDirectory(canonicalPrivateRoot);
	let current = canonicalPrivateRoot;
	for (const segment of canonicalRelative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		fs.mkdirSync(current, { recursive: true, mode: 0o700 });
		securePrivateDirectory(current);
	}
}

export function openPrivateFile(filePath: string, flags: number): number {
	assertNoSymlinkPathComponents(filePath);
	const descriptor = fs.openSync(filePath, flags | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
	try {
		const stat = fs.fstatSync(descriptor);
		const pathStat = fs.lstatSync(filePath);
		if (!stat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) throw new Error(`Private state file '${filePath}' changed while it was opened.`);
		if (!stat.isFile()) throw new Error(`Private state file '${filePath}' must be a regular file.`);
		assertOwnedByCurrentUser(stat, filePath);
		if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
		return descriptor;
	} catch (error) {
		fs.closeSync(descriptor);
		throw error;
	}
}
