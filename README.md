# Protobuf Tools

`Protobuf Tools` is a lightweight Visual Studio Code extension for `.proto` files — no separate language server, just the editor features you need, plus optional `protoc` validation and `protolint` linting.

Syntax highlighting and outline for gRPC-oriented `.proto` files:

<img src="https://raw.githubusercontent.com/glubean/proto3-tools/main/images/default.png" alt="Protobuf Tools syntax highlighting and outline" width="1100" />

Completion for scalar types, messages, enums, and service authoring:

<img src="https://raw.githubusercontent.com/glubean/proto3-tools/main/images/completion.png" alt="Protobuf Tools completion" width="1100" />

## Features

- Syntax highlighting for `.proto`
- Snippets for file headers, messages, enums, services, RPCs, and imports
- Completion for top-level keywords, message/service bodies, scalar types, common options, and local message/enum names
- Go to Definition for imports, messages, enums, and services
- Rename across the current file plus directly related imported/importing proto files
- Document Symbols / Outline for messages, enums, enum values, services, RPCs, oneofs, and fields
- Renumber Fields/Enum Values command
- `protoc` diagnostics on save
- Optional `protolint` diagnostics on save
- `proto3: Compile This Proto`
- `proto3: Compile All Protos`
- `proto3: Lint This Proto`
- `clang-format` document formatting
- Markdown fenced-code highlighting for `proto` and `protobuf`

## Validation And Linting

`Protobuf Tools` supports two complementary feedback loops:

- `protoc` validation for compile errors
- `protolint` linting for style and protobuf rule violations

If your team already uses `protolint` in CI, enable `protolint.lint_on_save` to surface the same rule feedback directly inside VS Code.

## Commands

| Command | Description |
| --- | --- |
| `proto3: Compile This Proto` | Compile the active `.proto` file with configured `protoc` arguments. |
| `proto3: Compile All Protos` | Compile every `.proto` file under the configured compile root. |
| `proto3: Lint This Proto` | Run `protolint` against the active `.proto` file. |
| `proto3: Renumber Fields/Enum Values` | Renumber message fields from `1` or enum values from `0` in the current scope. |

## Settings

The extension keeps the old `protoc.*` settings shape so migration is straightforward.

```json
{
  "protoc.path": "protoc",
  "protoc.options": [
    "--proto_path=${workspaceRoot}/proto",
    "--go_out=gen/go"
  ],
  "protoc.compile_on_save": false,
  "protoc.renumber_on_save": false,
  "protoc.compile_all_path": "",
  "protoc.use_absolute_path": false,
  "protolint.path": "protolint",
  "protolint.lint_on_save": false,
  "clang-format.style": "file",
  "clang-format.executable": "clang-format"
}
```

Enable `protolint` on save with:

```json
{
  "protolint.path": "protolint",
  "protolint.lint_on_save": true
}
```

### Supported variables

- `${workspaceRoot}`
- `${env.NAME}`
- `${config.some.setting}`

## Behavior Notes

- Diagnostics come from `protoc`, not from a custom semantic engine.
- `protolint` integration is optional and disabled by default.
- If `protolint` is not installed, the extension warns and continues without lint results.
- Rename is intentionally conservative in scope: current file plus directly related proto files.
- `Compile All` recursively scans the configured directory for `.proto` files.
- Formatting requires `clang-format` to be installed locally.

## Limits

This extension does not implement:

- a full language server
- semantic references / hover / code actions
- build-system-specific `buf` or Bazel integration
- gRPC request execution or schema testing

## Development

```bash
npm install
npm run build
npm test
```

Package a VSIX with:

```bash
npm run package:vsix
```

## About Glubean

`Protobuf Tools` is maintained by Glubean and stays focused on `.proto` authoring inside VS Code.

If you later need workflow-oriented API or gRPC testing, Glubean will be the broader product surface. This extension is intentionally the lightweight editor entry point.

## Contributing

Protobuf Tools is AI-first by design.

If you want to contribute a feature or fix, we strongly prefer small pull requests that are drafted with AI assistance, then reviewed by a human who understands the result. Clear scope, clear explanation, and easy verification matter more than big rewrites.
