export type ProtoNodeKind =
  | 'message'
  | 'enum'
  | 'service'
  | 'oneof'
  | 'field'
  | 'enumValue'
  | 'rpc';

export interface ProtoValueRange {
  line: number;
  start: number;
  end: number;
}

export interface ProtoImport {
  path: string;
  line: number;
  start: number;
  end: number;
}

export interface ProtoNode {
  kind: ProtoNodeKind;
  name: string;
  line: number;
  start: number;
  end: number;
  endLine: number;
  children: ProtoNode[];
  typeName?: string;
  requestType?: string;
  responseType?: string;
  valueRange?: ProtoValueRange;
}

export interface ProtoParseResult {
  imports: ProtoImport[];
  nodes: ProtoNode[];
}

interface SanitizeState {
  inBlockComment: boolean;
}

interface Frame {
  node?: ProtoNode;
}

const BLOCK_DECLARATION = /\b(message|enum|service|oneof)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const IMPORT_PATTERN = /^\s*import\s+(?:"([^"]+)"|'([^']+)')\s*;/;
const FIELD_PATTERN =
  /^\s*(?:(?:repeated|required|optional)\s+)?(map\s*<[^>]+>|[.A-Za-z_][A-Za-z0-9_.<>]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+)/;
const ENUM_VALUE_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+)/;
const RPC_PATTERN =
  /^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(?:stream\s+)?([.\w]+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([.\w]+)\s*\)/;

export function parseProto(text: string): ProtoParseResult {
  const imports: ProtoImport[] = [];
  const nodes: ProtoNode[] = [];
  const frames: Frame[] = [];
  const state: SanitizeState = { inBlockComment: false };
  let pendingNode: ProtoNode | undefined;
  let pendingAttachTarget: ProtoNode[] | undefined;
  const lines = text.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const originalLine = lines[lineIndex];
    const sanitized = sanitizeLine(originalLine, state);
    const currentScope = currentNamedScope(frames);

    const importMatch = IMPORT_PATTERN.exec(sanitized);
    if (importMatch) {
      const importPath = importMatch[1] ?? importMatch[2];
      const start = originalLine.indexOf(importPath);
      imports.push({
        path: importPath,
        line: lineIndex,
        start,
        end: start + importPath.length,
      });
    }

    const declarationMatch = BLOCK_DECLARATION.exec(sanitized);
    if (declarationMatch) {
      const kind = declarationMatch[1] as ProtoNodeKind;
      const name = declarationMatch[2];
      const start = declarationMatch.index + declarationMatch[0].lastIndexOf(name);
      const attachTarget = currentScope?.children ?? nodes;
      pendingNode = {
        kind,
        name,
        line: lineIndex,
        start,
        end: start + name.length,
        endLine: lineIndex,
        children: [],
      };
      pendingAttachTarget = attachTarget;
    } else if (currentScope?.kind === 'service') {
      const rpcMatch = RPC_PATTERN.exec(sanitized);
      if (rpcMatch) {
        const name = rpcMatch[1];
        const start = originalLine.indexOf(name);
        currentScope.children.push({
          kind: 'rpc',
          name,
          line: lineIndex,
          start,
          end: start + name.length,
          endLine: lineIndex,
          children: [],
          requestType: rpcMatch[2],
          responseType: rpcMatch[3],
        });
      }
    } else if (currentScope?.kind === 'message' || currentScope?.kind === 'oneof') {
      const fieldMatch = FIELD_PATTERN.exec(sanitized);
      if (fieldMatch) {
        const name = fieldMatch[2];
        const start = originalLine.indexOf(name);
        const value = fieldMatch[3];
        const valueStart = originalLine.indexOf(value, start + name.length);
        currentScope.children.push({
          kind: 'field',
          name,
          line: lineIndex,
          start,
          end: start + name.length,
          endLine: lineIndex,
          children: [],
          typeName: normalizeTypeName(fieldMatch[1]),
          valueRange: {
            line: lineIndex,
            start: valueStart,
            end: valueStart + value.length,
          },
        });
      }
    } else if (currentScope?.kind === 'enum') {
      const enumMatch = ENUM_VALUE_PATTERN.exec(sanitized);
      if (enumMatch) {
        const name = enumMatch[1];
        const start = originalLine.indexOf(name);
        const value = enumMatch[2];
        const valueStart = originalLine.indexOf(value, start + name.length);
        currentScope.children.push({
          kind: 'enumValue',
          name,
          line: lineIndex,
          start,
          end: start + name.length,
          endLine: lineIndex,
          children: [],
          valueRange: {
            line: lineIndex,
            start: valueStart,
            end: valueStart + value.length,
          },
        });
      }
    }

    for (let index = 0; index < sanitized.length; index++) {
      const char = sanitized[index];
      if (char === '{') {
        if (pendingNode && pendingAttachTarget) {
          pendingAttachTarget.push(pendingNode);
          frames.push({ node: pendingNode });
          pendingNode = undefined;
          pendingAttachTarget = undefined;
        } else {
          frames.push({});
        }
      } else if (char === '}') {
        const frame = frames.pop();
        if (frame?.node) {
          frame.node.endLine = lineIndex;
        }
      }
    }

    if (pendingNode && !sanitized.includes('{')) {
      continue;
    }
  }

  const lastLine = Math.max(lines.length - 1, 0);
  for (const frame of frames) {
    if (frame.node) {
      frame.node.endLine = lastLine;
    }
  }
  if (pendingNode && pendingAttachTarget) {
    pendingAttachTarget.push(pendingNode);
  }

  return { imports, nodes };
}

export function findEnclosingNode(result: ProtoParseResult, line: number, kinds?: ProtoNodeKind[]): ProtoNode | undefined {
  let match: ProtoNode | undefined;
  visitNodes(result.nodes, node => {
    if (line >= node.line && line <= node.endLine && (!kinds || kinds.includes(node.kind))) {
      if (!match || node.line >= match.line) {
        match = node;
      }
    }
  });
  return match;
}

export function collectNamedTypes(result: ProtoParseResult): ProtoNode[] {
  const types: ProtoNode[] = [];
  visitNodes(result.nodes, node => {
    if (node.kind === 'message' || node.kind === 'enum') {
      types.push(node);
    }
  });
  return types;
}

export function findDefinitionByName(result: ProtoParseResult, name: string): ProtoNode | undefined {
  let match: ProtoNode | undefined;
  visitNodes(result.nodes, node => {
    if ((node.kind === 'message' || node.kind === 'enum' || node.kind === 'service') && node.name === name && !match) {
      match = node;
    }
  });
  return match;
}

export function buildRenumberEdits(text: string, line: number): ProtoValueRange[] {
  const result = parseProto(text);
  const target = findEnclosingNode(result, line, ['message', 'enum']);
  if (!target) {
    return [];
  }
  if (target.kind === 'enum') {
    return target.children
      .filter(child => child.kind === 'enumValue' && child.valueRange)
      .map(child => child.valueRange as ProtoValueRange);
  }
  return flattenMessageFields(target)
    .filter(child => child.valueRange)
    .map(child => child.valueRange as ProtoValueRange);
}

export function flattenMessageFields(node: ProtoNode): ProtoNode[] {
  const items: ProtoNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'field') {
      items.push(child);
    } else if (child.kind === 'oneof') {
      items.push(...flattenMessageFields(child));
    }
  }
  return items;
}

export function renumberText(text: string, line: number): string {
  const result = parseProto(text);
  const target = findEnclosingNode(result, line, ['message', 'enum']);
  if (!target) {
    return text;
  }

  const lines = text.split(/\r?\n/);
  const edits =
    target.kind === 'enum'
      ? target.children
          .filter(child => child.kind === 'enumValue' && child.valueRange)
          .map((child, index) => ({ range: child.valueRange as ProtoValueRange, value: String(index) }))
      : flattenMessageFields(target)
          .filter(child => child.valueRange)
          .map((child, index) => ({ range: child.valueRange as ProtoValueRange, value: String(index + 1) }));

  for (const edit of edits.reverse()) {
    const currentLine = lines[edit.range.line];
    lines[edit.range.line] =
      currentLine.slice(0, edit.range.start) + edit.value + currentLine.slice(edit.range.end);
  }

  return lines.join('\n');
}

function sanitizeLine(line: string, state: SanitizeState): string {
  let result = '';
  let inString = false;
  let quote = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (state.inBlockComment) {
      if (char === '*' && next === '/') {
        state.inBlockComment = false;
        result += '  ';
        index++;
      } else {
        result += ' ';
      }
      continue;
    }

    if (inString) {
      if (char === '\\') {
        result += ' ';
        if (index + 1 < line.length) {
          result += ' ';
          index++;
        }
        continue;
      }
      result += char;
      if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '/' && next === '*') {
      state.inBlockComment = true;
      result += '  ';
      index++;
      continue;
    }
    if (char === '/' && next === '/') {
      result += ' '.repeat(line.length - index);
      break;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      result += char;
      continue;
    }
    result += char;
  }
  return result.padEnd(line.length, ' ');
}

function currentNamedScope(frames: Frame[]): ProtoNode | undefined {
  for (let index = frames.length - 1; index >= 0; index--) {
    if (frames[index].node) {
      return frames[index].node;
    }
  }
  return undefined;
}

function visitNodes(nodes: ProtoNode[], fn: (node: ProtoNode) => void): void {
  for (const node of nodes) {
    fn(node);
    visitNodes(node.children, fn);
  }
}

function normalizeTypeName(typeName: string): string {
  return typeName.replace(/\s+/g, '');
}
