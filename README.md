# Rawback CLI

Command-line tools for Rawback users and AI agents.

## Requirements

- [Bun 1.3.14](https://bun.sh/)

## Development

Install the pinned dependencies:

```bash
bun install --frozen-lockfile
```

Run the CLI from source:

```bash
bun run dev -- --help
```

Run all validation checks and compile a local standalone binary:

```bash
bun run check
./dist/rawback --version
```

Individual checks are also available:

```bash
bun run typecheck
bun test
bun run lint
bun run format:check
```

Install the Git pre-commit hooks with `bun run hooks:install`. The hooks format
and lint staged TypeScript and JavaScript files using the same tools as CI.

## Usage

```text
rawback [options]

Rawback CLI for humans and AI agents

Options:
  -h, --help     display help for command    [boolean]
  -V, --version  output the current version  [boolean]
```

Unknown arguments are reported on stderr and exit with status 1.

## Releases

Release Please maintains versions and the changelog from Conventional Commits.
When its release PR is merged, GoReleaser compiles and publishes standalone
archives for:

- Linux x86-64 (baseline) and arm64
- macOS x86-64 and arm64
- Windows x86-64 (baseline)

Each GitHub Release includes a `checksums.txt` file. Package-manager publishing,
code signing, and notarization are not configured yet.
