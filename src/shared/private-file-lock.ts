import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS, isRetryableFileSystemError, waitForFileSystemRetry } from "./file-system-retry.ts";

const PRIVATE_FILE_LOCK_STALE_MS = 60_000;

interface PrivateFileLockOwner {
	pid: number;
	token: string;
	createdAt: number;
	processKey?: string;
}

export interface PrivateFileLockOptions {
	label?: string;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function linuxProcessStartKey(pid: number): string | undefined {
	try {
		const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
		const tail = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
		return tail[19] ? `linux:${tail[19]}` : undefined;
	} catch {
		return undefined;
	}
}

function psProcessStartKey(pid: number): string | undefined {
	try {
		const raw = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim();
		return raw ? `ps:${raw}` : undefined;
	} catch {
		return undefined;
	}
}

function windowsProcessStartKey(pid: number): string | undefined {
	try {
		const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CreationDate`], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000, windowsHide: true }).trim();
		return raw ? `win:${raw}` : undefined;
	} catch {
		return undefined;
	}
}

function processStartKey(pid: number): string | undefined {
	if (process.platform === "linux") return linuxProcessStartKey(pid) ?? psProcessStartKey(pid);
	if (process.platform === "win32") return windowsProcessStartKey(pid);
	return undefined;
}

const CURRENT_PROCESS_KEY = processStartKey(process.pid);

function readLockOwner(lockPath: string): PrivateFileLockOwner | undefined {
	try {
		const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf-8")) as { pid?: unknown; token?: unknown; createdAt?: unknown; processKey?: unknown };
		if (Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0 && typeof owner.token === "string" && owner.token && Number.isSafeInteger(owner.createdAt)) {
			return {
				pid: owner.pid as number,
				token: owner.token,
				createdAt: owner.createdAt as number,
				...(typeof owner.processKey === "string" && owner.processKey ? { processKey: owner.processKey } : {}),
			};
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function lockIsStale(lockPath: string, now = Date.now()): boolean {
	const owner = readLockOwner(lockPath);
	if (owner) {
		if (!isProcessAlive(owner.pid)) return true;
		if (owner.processKey) {
			const currentProcessKey = owner.pid === process.pid ? CURRENT_PROCESS_KEY : processStartKey(owner.pid);
			if (currentProcessKey) return owner.processKey !== currentProcessKey;
			if (owner.pid === process.pid) return true;
		}
		return false;
	}
	try {
		return now - fs.statSync(lockPath).mtimeMs > PRIVATE_FILE_LOCK_STALE_MS;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function removeOwnedLock(lockPath: string, owner: PrivateFileLockOwner): void {
	const current = readLockOwner(lockPath);
	if (current?.token !== owner.token) return;
	fs.rmSync(lockPath, { recursive: true, force: true });
}

function staleDirectoryExists(dirPath: string, now = Date.now()): boolean {
	try {
		return now - fs.statSync(dirPath).mtimeMs > PRIVATE_FILE_LOCK_STALE_MS;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function tryMakeDirectory(dirPath: string, mode: number): boolean {
	try {
		fs.mkdirSync(dirPath, { mode });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

function waitForLock(delayMs: number | undefined, lockPath: string, label: string): void {
	if (delayMs === undefined) throw new Error(`Timed out acquiring ${label} lock '${lockPath}'.`);
	waitForFileSystemRetry(delayMs);
}

function reclaimStaleLock(lockPath: string, reclaimPath: string): boolean {
	if (!lockIsStale(lockPath)) return false;
	if (!tryMakeDirectory(reclaimPath, 0o700)) return false;
	try {
		if (!lockIsStale(lockPath)) return false;
		fs.rmSync(lockPath, { recursive: true, force: true });
		return true;
	} finally {
		fs.rmSync(reclaimPath, { recursive: true, force: true });
	}
}

export function withPrivateFileLock<T>(filePath: string, operation: () => T, options: PrivateFileLockOptions = {}): T {
	if (!path.isAbsolute(filePath)) throw new Error("Private file lock path must be absolute.");
	const label = options.label?.trim() || "private file";
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const lockPath = `${filePath}.lock`;
	const reclaimPath = `${lockPath}.reclaim`;
	let owner: PrivateFileLockOwner | undefined;
	for (let attempt = 0; ; attempt++) {
		if (fs.existsSync(reclaimPath)) {
			if (staleDirectoryExists(reclaimPath)) {
				fs.rmSync(reclaimPath, { recursive: true, force: true });
				continue;
			}
			waitForLock(DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS[attempt], lockPath, label);
			continue;
		}
		let acquired = false;
		try {
			acquired = tryMakeDirectory(lockPath, 0o700);
		} catch (error) {
			if (isRetryableFileSystemError(error)) {
				waitForLock(DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS[attempt], lockPath, label);
				continue;
			}
			throw new Error(`Failed to acquire ${label} lock '${lockPath}': ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!acquired) {
			if (reclaimStaleLock(lockPath, reclaimPath)) continue;
			waitForLock(DEFAULT_FILE_SYSTEM_RETRY_DELAYS_MS[attempt], lockPath, label);
			continue;
		}
		owner = { pid: process.pid, token: randomUUID(), createdAt: Date.now(), ...(CURRENT_PROCESS_KEY ? { processKey: CURRENT_PROCESS_KEY } : {}) };
		try {
			fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify(owner), { encoding: "utf-8", mode: 0o600 });
		} catch (error) {
			fs.rmSync(lockPath, { recursive: true, force: true });
			owner = undefined;
			throw error;
		}
		break;
	}
	try {
		return operation();
	} finally {
		if (owner) removeOwnedLock(lockPath, owner);
	}
}
