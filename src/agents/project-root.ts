import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectConfigDir } from "../shared/config-paths.ts";

function isDirectory(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

export function findProjectRootCandidates(cwd: string): string[] {
	const roots: string[] = [];
	let currentDir = cwd;
	while (true) {
		if (isDirectory(getProjectConfigDir(currentDir)) || isDirectory(path.join(currentDir, ".agents"))) roots.push(currentDir);
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return roots;
		currentDir = parentDir;
	}
}

export function findNearestProjectRoot(cwd: string): string | null {
	return findProjectRootCandidates(cwd)[0] ?? null;
}
