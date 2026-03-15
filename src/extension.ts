import * as childProcess from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceFolderForUri, getWorkspaceRoot, readSettings } from './config';
import { ProtoCompiler } from './compiler';
import { ProtoLinter } from './linter';
import {
  ProtoImport,
  ProtoNode,
  ProtoParseResult,
  collectNamedTypes,
  findDefinitionByName,
  findEnclosingNode,
  parseProto,
  renumberText,
} from './protoModel';

const LANGUAGE_SELECTOR: vscode.DocumentSelector = { language: 'proto3', scheme: 'file' };
const TOP_LEVEL_KEYWORDS = ['syntax', 'package', 'import', 'option', 'message', 'enum', 'service'];
const MESSAGE_KEYWORDS = ['message', 'enum', 'oneof', 'option', 'reserved', 'repeated', 'optional'];
const SERVICE_KEYWORDS = ['rpc', 'option'];
const ENUM_KEYWORDS = ['option'];
const SCALAR_TYPES = [
  'bool',
  'bytes',
  'double',
  'fixed32',
  'fixed64',
  'float',
  'int32',
  'int64',
  'sfixed32',
  'sfixed64',
  'sint32',
  'sint64',
  'string',
  'uint32',
  'uint64',
];
const COMMON_OPTIONS = [
  'java_package',
  'java_outer_classname',
  'go_package',
  'csharp_namespace',
  'optimize_for',
  'deprecated',
  'allow_alias',
  'packed',
];
const PRIMITIVE_TYPES = new Set(SCALAR_TYPES);

const parseCache = new Map<string, ProtoParseResult>();

export function activate(context: vscode.ExtensionContext): void {
  const compiler = new ProtoCompiler();
  const linter = new ProtoLinter();
  context.subscriptions.push({ dispose: () => compiler.dispose() });
  context.subscriptions.push({ dispose: () => linter.dispose() });

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      LANGUAGE_SELECTOR,
      new ProtoCompletionProvider(),
      '.',
      '"'
    ),
    vscode.languages.registerDefinitionProvider(LANGUAGE_SELECTOR, new ProtoDefinitionProvider()),
    vscode.languages.registerRenameProvider(LANGUAGE_SELECTOR, new ProtoRenameProvider()),
    vscode.languages.registerDocumentSymbolProvider(LANGUAGE_SELECTOR, new ProtoDocumentSymbolProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_SELECTOR, new ProtoFormattingProvider()),
    vscode.commands.registerCommand('proto3.compile.one', async () => {
      await compiler.compileActiveDocument();
    }),
    vscode.commands.registerCommand('proto3.compile.all', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || document.languageId !== 'proto3') {
        return;
      }
      await compiler.compileAllFromDocument(document);
    }),
    vscode.commands.registerCommand('proto3.lint.one', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || document.languageId !== 'proto3') {
        return;
      }
      await linter.lintDocument(document);
    }),
    vscode.commands.registerCommand('proto3.renumber.scope', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'proto3') {
        return;
      }
      const updated = renumberText(editor.document.getText(), editor.selection.active.line);
      if (updated === editor.document.getText()) {
        return;
      }
      await editor.edit(edit => {
        const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
        edit.replace(new vscode.Range(0, 0, editor.document.lineCount - 1, lastLine.text.length), updated);
      });
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      parseCache.delete(cacheKey(event.document));
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      parseCache.delete(cacheKey(document));
    }),
    vscode.workspace.onWillSaveTextDocument(event => {
      if (event.document.languageId !== 'proto3') {
        return;
      }
      const settings = readSettings(getWorkspaceFolderForUri(event.document.uri));
      if (!settings.renumberOnSave) {
        return;
      }
      const activeLine =
        vscode.window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()
          ? vscode.window.activeTextEditor.selection.active.line
          : 0;
      const after = renumberText(event.document.getText(), activeLine);
      if (after === event.document.getText()) {
        return;
      }
      const lastLine = event.document.lineAt(event.document.lineCount - 1);
      event.waitUntil(
        Promise.resolve([
          vscode.TextEdit.replace(new vscode.Range(0, 0, event.document.lineCount - 1, lastLine.text.length), after),
        ])
      );
    }),
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (document.languageId !== 'proto3') {
        return;
      }
      const settings = readSettings(getWorkspaceFolderForUri(document.uri));
      await compiler.validateDocument(document);
      if (settings.compileOnSave) {
        await compiler.compileDocument(document);
      }
      if (settings.protolintOnSave) {
        await linter.lintDocument(document);
      }
    })
  );

  vscode.languages.setLanguageConfiguration('proto3', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['<', '>'],
    ],
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"']*$/,
      decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
    },
  });
}

export function deactivate(): void {
  parseCache.clear();
}

class ProtoCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const parsed = getParsedDocument(document);
    const scope = findEnclosingNode(parsed, position.line);
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const items: vscode.CompletionItem[] = [];

    if (!scope) {
      return keywordsToItems(TOP_LEVEL_KEYWORDS, vscode.CompletionItemKind.Keyword);
    }

    if (/\boption\s+[\w.]*$/.test(linePrefix)) {
      return keywordsToItems(COMMON_OPTIONS, vscode.CompletionItemKind.Value);
    }

    if (scope.kind === 'message' || scope.kind === 'oneof') {
      items.push(...keywordsToItems(MESSAGE_KEYWORDS, vscode.CompletionItemKind.Keyword));
      items.push(...keywordsToItems(SCALAR_TYPES, vscode.CompletionItemKind.Keyword));
      items.push(...typeItems(parsed));
      return dedupeItems(items);
    }

    if (scope.kind === 'service') {
      return keywordsToItems(SERVICE_KEYWORDS, vscode.CompletionItemKind.Keyword);
    }

    if (scope.kind === 'enum') {
      return keywordsToItems(ENUM_KEYWORDS, vscode.CompletionItemKind.Keyword);
    }

    return keywordsToItems(TOP_LEVEL_KEYWORDS, vscode.CompletionItemKind.Keyword);
  }
}

class ProtoDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
    const parsed = getParsedDocument(document);
    const importTarget = findImportTarget(parsed.imports, position);
    if (importTarget) {
      const uri = await resolveImportUri(importTarget.path, document.uri);
      if (!uri) {
        return undefined;
      }
      return new vscode.Location(uri, new vscode.Position(0, 0));
    }

    const range = document.getWordRangeAtPosition(position, /[.\w]+/);
    if (!range) {
      return undefined;
    }
    const rawWord = document.getText(range);
    const name = rawWord.split('.').pop() ?? rawWord;
    if (PRIMITIVE_TYPES.has(name)) {
      return undefined;
    }

    const direct = findDefinitionByName(parsed, name);
    if (direct) {
      return new vscode.Location(document.uri, new vscode.Range(direct.line, direct.start, direct.line, direct.end));
    }

    const uris = await vscode.workspace.findFiles('**/*.proto', '**/{node_modules,.git}/**', 2000);
    for (const uri of uris) {
      if (uri.toString() === document.uri.toString()) {
        continue;
      }
      const text = await readUri(uri);
      const match = findDefinitionByName(parseProto(text), name);
      if (match) {
        return new vscode.Location(uri, new vscode.Range(match.line, match.start, match.line, match.end));
      }
    }
    return undefined;
  }
}

class ProtoRenameProvider implements vscode.RenameProvider {
  async prepareRename(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Range | undefined> {
    return document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  }

  async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): Promise<vscode.WorkspaceEdit> {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    const edits = new vscode.WorkspaceEdit();
    if (!range) {
      return edits;
    }

    const oldName = document.getText(range);
    const relatedUris = await collectRelatedUris(document.uri);
    for (const uri of relatedUris) {
      const text = uri.toString() === document.uri.toString() ? document.getText() : await readUri(uri);
      const regex = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'g');
      const lines = text.split(/\r?\n/);
      for (let line = 0; line < lines.length; line++) {
        const currentLine = lines[line];
        let match: RegExpExecArray | null;
        while ((match = regex.exec(currentLine)) !== null) {
          edits.replace(uri, new vscode.Range(line, match.index, line, match.index + oldName.length), newName);
        }
      }
    }
    return edits;
  }
}

class ProtoDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const parsed = getParsedDocument(document);
    return parsed.nodes.map(node => toDocumentSymbol(node, document));
  }
}

class ProtoFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const folder = getWorkspaceFolderForUri(document.uri);
    const settings = readSettings(folder);
    const args: string[] = [];
    const cwd = getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath);

    if (document.uri.scheme === 'file') {
      args.push(`--assume-filename=${document.uri.fsPath}`);
    } else {
      args.push('--assume-filename=untitled.proto');
    }
    if (settings.clangFormatStyle) {
      args.push(`-style=${settings.clangFormatStyle}`);
    }

    try {
      const stdout = childProcess.execFileSync(settings.clangFormatExecutable, args, {
        cwd,
        input: document.getText(),
      });
      const lastLine = document.lineAt(document.lineCount - 1);
      return [
        vscode.TextEdit.replace(
          new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length),
          stdout.toString()
        ),
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`clang-format failed: ${message}`);
      return [];
    }
  }
}

function getParsedDocument(document: vscode.TextDocument): ProtoParseResult {
  const key = cacheKey(document);
  const cached = parseCache.get(key);
  if (cached) {
    return cached;
  }
  const parsed = parseProto(document.getText());
  parseCache.set(key, parsed);
  return parsed;
}

function cacheKey(document: vscode.TextDocument): string {
  return `${document.uri.toString()}@${document.version}`;
}

function keywordsToItems(values: string[], kind: vscode.CompletionItemKind): vscode.CompletionItem[] {
  return values.map(value => {
    const item = new vscode.CompletionItem(value, kind);
    item.insertText = value;
    return item;
  });
}

function typeItems(parsed: ProtoParseResult): vscode.CompletionItem[] {
  return collectNamedTypes(parsed).map(node => {
    const item = new vscode.CompletionItem(
      node.name,
      node.kind === 'enum' ? vscode.CompletionItemKind.Enum : vscode.CompletionItemKind.Struct
    );
    item.detail = node.kind;
    return item;
  });
}

function dedupeItems(items: vscode.CompletionItem[]): vscode.CompletionItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.label.toString();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toDocumentSymbol(node: ProtoNode, document: vscode.TextDocument): vscode.DocumentSymbol {
  const endChar = document.lineAt(Math.min(node.endLine, document.lineCount - 1)).text.length;
  const symbol = new vscode.DocumentSymbol(
    node.name,
    node.kind,
    toSymbolKind(node.kind),
    new vscode.Range(node.line, 0, Math.min(node.endLine, document.lineCount - 1), endChar),
    new vscode.Range(node.line, node.start, node.line, node.end)
  );
  symbol.children = node.children.map(child => toDocumentSymbol(child, document));
  return symbol;
}

function toSymbolKind(kind: ProtoNode['kind']): vscode.SymbolKind {
  switch (kind) {
    case 'message':
      return vscode.SymbolKind.Struct;
    case 'enum':
      return vscode.SymbolKind.Enum;
    case 'service':
      return vscode.SymbolKind.Interface;
    case 'oneof':
      return vscode.SymbolKind.Object;
    case 'field':
      return vscode.SymbolKind.Field;
    case 'enumValue':
      return vscode.SymbolKind.EnumMember;
    case 'rpc':
      return vscode.SymbolKind.Method;
  }
}

function findImportTarget(imports: ProtoImport[], position: vscode.Position): ProtoImport | undefined {
  return imports.find(item => item.line === position.line && position.character >= item.start && position.character <= item.end);
}

async function resolveImportUri(importPath: string, baseUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = getWorkspaceFolderForUri(baseUri);
  const root = getWorkspaceRoot(folder);
  const sibling = path.join(path.dirname(baseUri.fsPath), importPath);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(sibling));
    return vscode.Uri.file(sibling);
  } catch {
    // fall through
  }
  if (root) {
    const absolute = path.join(root, importPath);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absolute));
      return vscode.Uri.file(absolute);
    } catch {
      // fall through
    }
  }

  const matches = await vscode.workspace.findFiles(`**/${importPath}`, '**/{node_modules,.git}/**', 20);
  return matches[0];
}

async function collectRelatedUris(source: vscode.Uri): Promise<vscode.Uri[]> {
  const uris = await vscode.workspace.findFiles('**/*.proto', '**/{node_modules,.git}/**', 2000);
  const related = new Set<string>([source.toString()]);
  const sourceText = await readUri(source);
  const sourceParsed = parseProto(sourceText);

  for (const item of sourceParsed.imports) {
    const target = await resolveImportUri(item.path, source);
    if (target) {
      related.add(target.toString());
    }
  }

  const sourceSuffixes = possibleImportSuffixes(source);
  for (const uri of uris) {
    if (related.has(uri.toString())) {
      continue;
    }
    const text = await readUri(uri);
    const parsed = parseProto(text);
    if (parsed.imports.some(item => sourceSuffixes.has(item.path.replace(/\\/g, '/')))) {
      related.add(uri.toString());
    }
  }

  return Array.from(related).map(value => vscode.Uri.parse(value));
}

function possibleImportSuffixes(uri: vscode.Uri): Set<string> {
  const suffixes = new Set<string>();
  const normalized = uri.fsPath.replace(/\\/g, '/');
  suffixes.add(path.basename(normalized));
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const relative = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
    if (!relative.startsWith('..')) {
      suffixes.add(relative);
    }
  }
  return suffixes;
}

async function readUri(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
  if (open) {
    return open.getText();
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
