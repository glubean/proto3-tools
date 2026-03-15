import * as childProcess from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWorkspaceFolderForUri, getWorkspaceRoot, readSettings } from './config';
import { parseProtolintOutput } from './protolintParser';

export class ProtoLinter {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('proto3-tools-protolint');

  dispose(): void {
    this.diagnostics.dispose();
  }

  async lintDocument(document: vscode.TextDocument): Promise<void> {
    const folder = getWorkspaceFolderForUri(document.uri);
    const settings = readSettings(folder);
    const cwd = getWorkspaceRoot(folder) || path.dirname(document.uri.fsPath);
    const stderr = await runProcess(settings.protolintPath, ['lint', document.uri.fsPath], cwd);
    const parse = toDiagnostics(document, stderr);

    if (!parse.recognized && parse.raw.trim()) {
      const binaryError = parse.raw.trim();
      if (
        binaryError.includes('not found') ||
        binaryError.includes('ENOENT') ||
        binaryError.includes('is not recognized')
      ) {
        void vscode.window.showWarningMessage(
          `protolint was not found at "${settings.protolintPath}". Install protolint or update protolint.path.`
        );
      } else {
        void vscode.window.showWarningMessage(`protolint: ${binaryError}`);
      }
    }

    this.diagnostics.set(document.uri, parse.diagnostics);
  }
}

function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise(resolve => {
    childProcess.execFile(command, args, { cwd }, (error, stdout, stderr) => {
      const stderrText = typeof stderr === 'string' ? stderr : String(stderr ?? '');
      const stdoutText = typeof stdout === 'string' ? stdout : String(stdout ?? '');
      if (error && !stderrText && !stdoutText) {
        resolve(error.message);
        return;
      }
      resolve([stderrText, stdoutText].filter(Boolean).join('\n'));
    });
  });
}

function toDiagnostics(
  document: vscode.TextDocument,
  output: string
): { diagnostics: vscode.Diagnostic[]; recognized: boolean; raw: string } {
  const parsed = parseProtolintOutput(document.uri.fsPath, output);
  const diagnostics = parsed.messages
    .filter(message => message.line < document.lineCount)
    .map(
      message =>
        new vscode.Diagnostic(
          new vscode.Range(
            message.line,
            message.column,
            message.line,
            document.lineAt(message.line).text.length
          ),
          message.message,
          vscode.DiagnosticSeverity.Warning
        )
    );

  return {
    diagnostics,
    recognized: parsed.recognized,
    raw: parsed.raw,
  };
}
