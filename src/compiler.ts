import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceFolderForUri, getWorkspaceRoot, readSettings } from './config';

export class ProtoCompiler {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('proto-vsc');

  dispose(): void {
    this.diagnostics.dispose();
  }

  async validateDocument(document: vscode.TextDocument): Promise<void> {
    const folder = getWorkspaceFolderForUri(document.uri);
    const settings = readSettings(folder);
    const tempFile = path.join(getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath), '.proto-vsc.pb');
    const protoPathOptions = settings.protocOptions.filter(option => option.startsWith('--proto_path') || option.startsWith('-I'));
    const args = [...protoPathOptions, `--descriptor_set_out=${tempFile}`, document.uri.fsPath];
    const cwd = getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath);
    const stderr = await runProcess(settings.protocPath, args, cwd);
    this.diagnostics.set(document.uri, parseDiagnostics(document, stderr));
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }

  async compileDocument(document: vscode.TextDocument): Promise<void> {
    const folder = getWorkspaceFolderForUri(document.uri);
    const settings = readSettings(folder);
    const cwd = getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath);
    const stderr = await runProcess(settings.protocPath, [...settings.protocOptions, document.uri.fsPath], cwd);
    this.diagnostics.set(document.uri, parseDiagnostics(document, stderr));
  }

  async compileActiveDocument(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'proto3') {
      return;
    }
    await this.compileDocument(document);
  }

  async compileAllFromDocument(document: vscode.TextDocument): Promise<void> {
    const folder = getWorkspaceFolderForUri(document.uri);
    const settings = readSettings(folder);
    const cwd = getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath);
    const files = collectProtoFiles(settings.compileAllPath || cwd);

    for (const file of files) {
      const target = settings.useAbsolutePath ? file : path.relative(cwd, file);
      const stderr = await runProcess(settings.protocPath, [...settings.protocOptions, target], cwd);
      if (stderr.trim()) {
        vscode.window.showErrorMessage(stderr.trim());
        return;
      }
    }
  }
}

export function collectProtoFiles(root: string): string[] {
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  walk(root, files);
  return files.sort();
}

function walk(dir: string, files: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.proto')) {
      files.push(fullPath);
    }
  }
}

function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise(resolve => {
    childProcess.execFile(command, args, { cwd }, (error, _stdout, stderr) => {
      if (error && !stderr) {
        resolve(error.message);
        return;
      }
      resolve(stderr || '');
    });
  });
}

function parseDiagnostics(document: vscode.TextDocument, stderr: string): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const match = /([^:]+\.proto):(\d+):(\d+):\s*(.*)/.exec(line.trim());
    if (!match) {
      continue;
    }
    const filePath = match[1];
    if (!document.uri.fsPath.endsWith(filePath) && path.basename(document.uri.fsPath) !== path.basename(filePath)) {
      continue;
    }
    const lineNumber = Math.max(Number(match[2]) - 1, 0);
    if (lineNumber >= document.lineCount) {
      continue;
    }
    const charNumber = Math.max(Number(match[3]) - 1, 0);
    const message = match[4];
    const range = new vscode.Range(lineNumber, charNumber, lineNumber, document.lineAt(lineNumber).text.length);
    diagnostics.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error));
  }
  return diagnostics;
}
