import * as path from 'path';

export interface ParsedProtolintMessage {
  filePath: string;
  line: number;
  column: number;
  message: string;
}

export interface ParsedProtolintOutput {
  messages: ParsedProtolintMessage[];
  recognized: boolean;
  raw: string;
}

export function parseProtolintOutput(documentPath: string, output: string): ParsedProtolintOutput {
  const messages: ParsedProtolintMessage[] = [];
  let recognized = false;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const bracketMatch = /^\[([^\]:]+\.proto):(\d+):(\d+)\]\s*(.+)$/.exec(line);
    const colonMatch = /^([^:]+\.proto):(\d+):(\d+):\s*(.+)$/.exec(line);
    const match = bracketMatch ?? colonMatch;
    if (!match) {
      continue;
    }

    recognized = true;
    const filePath = match[1];
    if (!documentPath.endsWith(filePath) && path.basename(documentPath) !== path.basename(filePath)) {
      continue;
    }

    messages.push({
      filePath,
      line: Math.max(Number(match[2]) - 1, 0),
      column: Math.max(Number(match[3]) - 1, 0),
      message: match[4],
    });
  }

  return { messages, recognized, raw: output };
}
