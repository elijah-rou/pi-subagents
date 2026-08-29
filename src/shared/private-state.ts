import * as fs from "node:fs";
import * as path from "node:path";

function assertOwnedByCurrentUser(stat: fs.Stats, target: string): void {
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) throw new Error(`Private state path '${target}' has the wrong owner.`);
}

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

export function ensurePrivateDirectory(target: string): void {
	const absolute = path.resolve(target);
	assertNoSymlinkPathComponents(absolute);
	fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
	const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
	const descriptor = fs.openSync(absolute, flags);
	try {
		const stat = fs.fstatSync(descriptor);
		if (!stat.isDirectory()) throw new Error(`Private state path '${absolute}' must be a directory.`);
		assertOwnedByCurrentUser(stat, absolute);
		if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o700);
	} finally {
		fs.closeSync(descriptor);
	}
}

export function openPrivateFile(filePath: string, flags: number): number {
	assertNoSymlinkPathComponents(filePath);
	const descriptor = fs.openSync(filePath, flags | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
	try {
		const stat = fs.fstatSync(descriptor);
		if (!stat.isFile()) throw new Error(`Private state file '${filePath}' must be a regular file.`);
		assertOwnedByCurrentUser(stat, filePath);
		if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
		return descriptor;
	} catch (error) {
		fs.closeSync(descriptor);
		throw error;
	}
}
