# Rawback CLI

Use [Rawback](https://rawback.app) from a terminal or an automation script. The
CLI can sign in to your account, upload photo and RAW files, search your library,
manage albums and their Markdown articles, inspect usage, and open your profile
in a browser.

## What you can do

- Upload a file or recursively upload a directory over SFTP.
- Safely resume an interrupted upload and skip exact files already uploaded.
- Check which local photo and RAW files are already in your Rawback library.
- Find photos by describing them — "from 2012, all images in NYC" — or by
  metadata, capture date, rating, location, and GPS data.
- Create and curate albums, smart filters, cover images, tags, and Markdown stories.
- List and inspect daily AI-generated dream recaps, including their contributing photos.
- Browse content shared with you and manage your outgoing share links.
- Control a Canon camera over CCAPI: shoot, change settings, browse and download the card, and stream live view.
- Manage the SFTP credentials associated with your account.
- Inspect the shared local configuration without exposing its SFTP password.
- Inspect upload sessions, storage usage, AI credits, and pricing.
- Request machine-readable JSON from read and credential commands.

## Install

### Installer script

On Linux and macOS, download the matching release, verify its SHA-256 checksum,
and install it into `~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/rawback-app/cli/main/install.sh | sh
```

The installer does not edit shell startup files. If `~/.local/bin` is not on
`PATH`, add it yourself. To choose another user-owned directory:

```bash
curl -fsSL https://raw.githubusercontent.com/rawback-app/cli/main/install.sh | \
  RAWBACK_INSTALL_DIR="$HOME/bin" sh
```

On Windows, run the PowerShell installer:

```powershell
irm https://raw.githubusercontent.com/rawback-app/cli/main/install.ps1 | iex
```

It installs to `$HOME\.local\bin` and warns if that directory is not on
`PATH`. Set `$env:RAWBACK_INSTALL_DIR` before running it to select another
directory.

### Homebrew

On macOS, install the signed and notarized binary from the Rawback tap:

```bash
brew install --cask rawback-app/tap/rawback
```

Upgrade it later with `brew upgrade --cask rawback-app/tap/rawback`.

### Manual download

Download the archive for your operating system and CPU, plus `checksums.txt`,
from [GitHub Releases](https://github.com/rawback-app/cli/releases). Verify the
archive, extract `rawback` (`rawback.exe` on Windows), and put it on `PATH`.

Once installed, view the available commands with:

```bash
rawback --help
```

Release archives are available for Linux, macOS, and Windows on both x86-64 and
arm64. The standalone binary does not require Bun. macOS binaries are Developer
ID-signed and notarized, including the bundled `ffmpeg` and `ffprobe` helpers;
Windows binaries are not currently Authenticode-signed.

### Build from source

[Bun 1.3.14](https://bun.sh/) is required:

```bash
git clone https://github.com/rawback-app/cli.git
cd cli
bun install --frozen-lockfile
bun run build
./dist/rawback --version
```

Move `dist/rawback` somewhere on your `PATH` if you want to run it outside the
repository.

To cross-compile every release target locally, install GoReleaser 2.17 and run:

```bash
bun run build:all
```

## Quick start

### 1. Sign in

```bash
rawback auth
rawback auth status
```

`rawback auth` creates a 10-minute device session, prints a copyable approval
link, and opens it in your browser. Sign in on the web if needed, review the CLI
request details, and authorize it. The resulting access and refresh tokens are
saved in `~/.rawback/credentials.json`. Expired access tokens are refreshed
automatically when possible. Temporary device-session creation failures are
retried before the command reports an error with a support trace ID when
available. Persistent device-authentication failures also include the raw server
error for diagnosis.

If you also run a local Rawback server, define it once in
`~/.rawback/config.yml` and sign into both — they stay signed in side by side:

```yaml
current: production
environments:
  production:
    apiHost: https://api.rawback.app
    webHost: https://rawback.app
  local:
    apiHost: http://localhost:23164
    webHost: http://localhost:3407
```

```bash
rawback --env local auth        # sign in without touching production
rawback config env list         # names, hosts, and which are signed in
rawback config use local        # make it the default for later commands
```

See [docs/configuration.md](docs/configuration.md#environments) for the full
format.

### 2. Browse your account

These commands work immediately after sign-in:

```bash
rawback photos list
rawback dream list
rawback album list
rawback shares list
rawback uploads
rawback usage
rawback usage --detail
rawback pricing
rawback config view
rawback web
```

Add `--json` to data-oriented commands when you need structured output:

```bash
rawback photos list --page-size 10 --json
rawback dream get 42 --json
rawback shares list --scope with-me --type album --json
rawback usage --json
rawback config view --json
```

Human-facing output uses a compact terminal UI with responsive columns, quota
meters, charts, status notices, and activity indicators. During uploads, an interactive terminal shows
aggregate progress, transfer speed, ETA, and the active files. Redirected output
stays line-oriented and does not contain cursor-control sequences. `--json`,
article `--content-only`, and `--version` remain undecorated for scripts and
other tools.

### 3. Set up uploads

Create an SFTP credential. Its password is displayed only once, so save it
before continuing:

```bash
rawback cred add --name "My computer"
```

Create `~/.rawback/config.yml` with the account slug shown by
`rawback auth status` and the generated password:

```yaml
sftp:
  endpoint: sftp://ftp.rawback.app:23168
  username: your-account-slug
  password: 'generated-password'
```

On Linux and macOS, protect the file because it contains a password:

```bash
chmod 600 ~/.rawback/config.yml
```

Inspect the stored file without exposing `sftp.password`:

```bash
rawback config view
rawback config view --json
```

The viewer does not apply environment overrides or built-in defaults. It prints
`[REDACTED]` in place of the stored SFTP password.

Local metadata parsing is sized automatically from the machine's CPU and memory.
To test an exact worker count, add an integer from 1 through 64; omit this block
to keep the recommended automatic behavior:

```yaml
metadata:
  concurrency: 8
```

This setting affects `photos check` and the metadata stage of `photos upload`.
The upload command's `--concurrency` option controls SFTP transfers separately.

Preview an upload, then run it:

```bash
rawback photos check --path ~/Pictures/Export
rawback photos upload --path ~/Pictures/Export --dry-run
rawback photos upload --path ~/Pictures/Export
```

Directories are scanned recursively. Symbolic links and unsupported files are
skipped; the command fails if the selected path contains no supported files.
Before SFTP transfer, the CLI reads capture metadata locally and skips a photo
only when both its filename and capture time match an existing Rawback image.
Files without usable capture metadata continue through normal SFTP verification.
Supported image formats are JPEG/JPG, PNG, WebP, GIF, TIFF, HEIC/HEIF, BMP, and
AVIF. Supported RAW formats are CR2, CR3, NEF, ARW, DNG, RAF, ORF, PEF, RW2,
SRW, and X3F.

`photos check` reports every supported local file as already in Rawback, not in
Rawback, or unknown. Add `--json` for a machine-readable report. A file is an
exact match when its filename and locally extracted EXIF capture time match an
image in the authenticated library; this is not a byte-content comparison.
In an interactive terminal, the command shows live progress while scanning
files, reading photo metadata, and checking Rawback. Redirected and JSON output
remain undecorated.

For host-key pinning, resumable-upload behavior, and troubleshooting, see
[Configuration and uploads](docs/configuration.md).

## Videos

Videos upload directly to storage instead of over SFTP, so they do not share
the photo upload pipeline:

```bash
rawback videos list
rawback videos upload --file ~/Movies/hike.mp4
rawback videos upload --file ~/Movies/hike.mp4 --thumbnail ~/Pictures/poster.jpg
rawback videos update --id 7 --title "Hike, day two"
rawback videos delete --id 7
```

Supported containers are MP4, M4V, MOV, WebM, MKV, AVI, MPEG, 3GP, and TS, up
to 100 GB. The file is sent in parts to presigned URLs and read from disk on
demand, so memory use stays flat regardless of file size. The CLI reads metadata,
attempts to extract a poster frame, and extracts audio for transcription locally.
Pass `--thumbnail` to supply your own poster frame or `--no-transcript` to skip
audio extraction.

The CLI uses `ffmpeg` and `ffprobe` from `PATH` first, falling back to each
bundled tool when missing. Each tool is resolved independently, so a system copy
of one can be used alongside a bundled copy of the other. See
[video tool setup](docs/configuration.md#video-tools) for details.

## Camera control

Rawback can drive a Canon camera directly over CCAPI, where the camera itself is
the HTTP server. Enable CCAPI in the camera's Wi-Fi menu first, note the address
and port it shows, and set a user name and password there if you want one.

```bash
# Pair once; the camera becomes the default target
rawback camera connect 'http://user:password@192.168.0.1:8080'

rawback camera info
rawback camera status --json
rawback camera shoot --force

# Browse and pull files off the card
rawback camera contents storages
rawback camera contents list card1 100CANON --json
rawback camera contents get '<locator>' --output ./shot.jpg
```

Every endpoint the camera advertises is reachable, whether or not it has a
dedicated command:

```bash
rawback camera api --list
rawback camera api shooting.getSetting --arg name=av --json
rawback camera interactive          # full-screen explorer
```

A camera serves **one client at a time**, so close the Canon app or Rawback
Desktop before connecting. Cameras also serve HTTPS with a self-signed
certificate; `rawback` verifies certificates by default and tells you to pass
`--insecure` when that is what you want.

## Common examples

```bash
# Describe what you want and let the server work out the filters
rawback photos search "from 2012, all images in NYC"

# Page through the same search without spending another AI credit
rawback photos search "from 2012, all images in NYC" --ai-search-id abc123 --page 2

# Search filenames and metadata literally
rawback photos list --search "Iceland"

# Combine filters; repeat or comma-separate multi-value filters
rawback photos list --camera-make Sony --rate 4,5 --has-gps

# Limit photos to a capture window
rawback photos list \
  --captured-after 2026-01-01 \
  --captured-before 2026-02-01

# Upload up to eight files in parallel
rawback photos upload --path ./photos --concurrency 8

# Inspect failed upload sessions
rawback uploads --status failed

# List and inspect daily dream recaps
rawback dream list
rawback dream get 42

# Retry a failed dream after an AI-credit warning
rawback dream retry 42

# Create and inspect an album
rawback album create --name "Iceland" --permission private
rawback album view 42

# Recollect the photos matching an album's smart filter
rawback album refresh 42

# Add a photo and write the album's Markdown article
rawback album image add 42 108
rawback album article edit 42 --title "Iceland in winter" --content-file story.md
rawback album article publish 42

# Browse incoming shares and manage an outgoing link
rawback shares list --scope with-me --type photo
rawback shares list --kind link --access restricted --expiry valid
rawback shares recipients 7
rawback shares link 7 --copy
rawback shares disable 7

# List, create, and revoke SFTP credentials
rawback cred list
rawback cred add --name "Home workstation"
rawback cred del 7
```

See the [command reference](docs/commands.md) for every command, option, default,
and automation note. You can also ask the binary for context-specific help:

```bash
rawback --help
rawback photos search --help
rawback photos list --help
rawback photos upload --help
rawback dream --help
rawback config --help
rawback album --help
rawback album article --help
rawback shares list --help
```

## Files and security

Rawback stores local state under `~/.rawback/`:

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `credentials.json`  | Access and refresh tokens per environment, from `rawback auth` |
| `config.yml`        | Environments, optional hosts, metadata workers, and SFTP       |
| `upload-state.json` | Shared upload queue, history, and trusted host keys            |
| `cameras.json`      | Saved Canon cameras, shared with Rawback Desktop               |

`cameras.json` is shared with the Rawback desktop app, so both can reach the same
camera without pairing twice. It holds a camera password only when you pass
`rawback camera connect --save-password`, and then in plain text at mode `0600` —
the same trade `config.yml` already makes for the SFTP password. Commands that
read it refuse a file that group or others can read.

The CLI creates credential, camera, and upload-state files with restrictive permissions
on Unix. You create `config.yml` yourself, so upload commands require it to have
mode `0600` on Unix. Never commit files from `~/.rawback/` or paste their secrets
into issues and logs. `rawback config view` masks every `sftp.password` in both
terminal and JSON output, including the ones inside `environments`.

## Development

Install the pinned dependencies and run the CLI from source:

```bash
bun install --frozen-lockfile
bun run dev -- --help
```

Run the complete local validation suite and smoke-test the compiled binary:

```bash
bun run check
./dist/rawback --version
```

Useful focused checks are:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
```

Install the repository's pre-commit hooks with `bun run hooks:install`. More
architecture, SDK integration, testing, and release notes are in
[the contributor guide](docs/development.md). Coding agents should also read
[`AGENTS.md`](AGENTS.md) before making changes.

## Releases

[Release Please](https://github.com/googleapis/release-please) derives versions
and changelogs from Conventional Commits. Merging its release PR triggers
GoReleaser, which builds all six platform archives, signs and notarizes the
macOS binaries, publishes the Homebrew Cask, and includes a `checksums.txt`
file with each GitHub Release.
