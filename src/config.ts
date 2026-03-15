import * as path from 'path';
import * as vscode from 'vscode';

export interface ProtoSettings {
  protocPath: string;
  protocOptions: string[];
  compileOnSave: boolean;
  renumberOnSave: boolean;
  compileAllPath: string;
  useAbsolutePath: boolean;
  protolintPath: string;
  protolintOnSave: boolean;
  clangFormatStyle: string;
  clangFormatExecutable: string;
}

export function getWorkspaceFolderForUri(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
  if (!uri) {
    return vscode.workspace.workspaceFolders?.[0];
  }
  return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
}

export function getWorkspaceRoot(folder?: vscode.WorkspaceFolder): string {
  return folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

export function readSettings(folder?: vscode.WorkspaceFolder): ProtoSettings {
  const protoc = vscode.workspace.getConfiguration('protoc', folder);
  const protolint = vscode.workspace.getConfiguration('protolint', folder);
  const clang = vscode.workspace.getConfiguration('clang-format', folder);
  const root = getWorkspaceRoot(folder);
  return {
    protocPath: resolveConfigString(protoc.get<string>('path', 'protoc'), folder),
    protocOptions: resolveConfigArray(protoc.get<string[]>('options', []), folder),
    compileOnSave: protoc.get<boolean>('compile_on_save', false),
    renumberOnSave: protoc.get<boolean>('renumber_on_save', false),
    compileAllPath: resolveCompileAllPath(protoc.get<string>('compile_all_path', ''), folder, root),
    useAbsolutePath: protoc.get<boolean>('use_absolute_path', false),
    protolintPath: resolveConfigString(protolint.get<string>('path', 'protolint'), folder),
    protolintOnSave: protolint.get<boolean>('lint_on_save', false),
    clangFormatStyle: clang.get<string>('style', 'file').trim(),
    clangFormatExecutable: clang.get<string>('executable', 'clang-format').trim() || 'clang-format',
  };
}

function resolveCompileAllPath(value: string, folder: vscode.WorkspaceFolder | undefined, root: string): string {
  const resolved = resolveConfigString(value, folder);
  if (!resolved) {
    return root;
  }
  if (path.isAbsolute(resolved)) {
    return resolved;
  }
  return root ? path.join(root, resolved) : resolved;
}

function resolveConfigArray(values: string[], folder?: vscode.WorkspaceFolder): string[] {
  return values.map(value => resolveConfigString(value, folder));
}

function resolveConfigString(value: string, folder?: vscode.WorkspaceFolder): string {
  const workspaceRoot = getWorkspaceRoot(folder);
  return value.replace(/\$\{([^}]+)\}/g, (_full, key: string) => {
    if (key === 'workspaceRoot') {
      return workspaceRoot;
    }
    if (key.startsWith('env.')) {
      return process.env[key.slice(4)] ?? '';
    }
    if (key.startsWith('config.')) {
      const configValue = vscode.workspace.getConfiguration().get<unknown>(key.slice(7));
      return typeof configValue === 'string' ? configValue : '';
    }
    return '';
  });
}
