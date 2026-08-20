import { render } from "grok-mermaid";

export interface MermaidTerminalOutput {
	kind: "diagram" | "source";
	lines: string[];
	reason?: "unsupported" | "too-wide";
}

const MAX_MERMAID_SOURCE_CHARACTERS = 32 * 1024;
const MAX_MERMAID_OUTPUT_LINES = 256;
const MAX_MERMAID_OUTPUT_CHARACTERS = 64 * 1024;

function readableSource(source: string): string[] {
	const bounded = source.slice(0, MAX_MERMAID_SOURCE_CHARACTERS);
	const lines = bounded.split("\n").slice(0, MAX_MERMAID_OUTPUT_LINES);
	if (bounded.length < source.length || bounded.split("\n").length > lines.length) lines.push("%% Additional topology source omitted");
	return lines;
}

/** Render Mermaid as bounded terminal art, retaining readable source when it cannot fit. */
export function renderMermaidTerminal(source: string, availableWidth: number): MermaidTerminalOutput {
	const sourceLines = readableSource(source);
	if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
		return { kind: "source", lines: sourceLines, reason: "too-wide" };
	}
	try {
		const art = render(sourceLines.join("\n"));
		const outputCharacters = art?.plain.reduce((total, line) => total + line.length, 0) ?? 0;
		if (!art || art.warnings.length > 0 || art.plain.length > MAX_MERMAID_OUTPUT_LINES || outputCharacters > MAX_MERMAID_OUTPUT_CHARACTERS) {
			return { kind: "source", lines: sourceLines, reason: "unsupported" };
		}
		if (art.width > availableWidth) {
			return { kind: "source", lines: sourceLines, reason: "too-wide" };
		}
		return { kind: "diagram", lines: art.plain };
	} catch {
		return { kind: "source", lines: sourceLines, reason: "unsupported" };
	}
}
