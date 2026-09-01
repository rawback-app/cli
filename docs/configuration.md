# Configuration and uploads

This guide explains the local Rawback files, custom service hosts, and the SFTP
upload workflow. For a concise first run, start with the
[README quick start](../README.md#quick-start).

## Configuration file

The CLI reads `~/.rawback/config.yml`. The file is optional until you upload
photos or need to override a service host.

```yaml
# Optional. Defaults to https://api.rawback.app
apiHost: https://api.rawback.app

# Optional. Used by `rawback web`; defaults to https://rawback.app
webHost: https://rawback.app

# Optional. Exact local metadata worker count from 1 through 64.
# Omit this block to size the worker pool automatically.
metadata:
  concurrency: 8

# Required only by `rawback photos upload`
sftp:
  endpoint: sftp://ftp.rawback.app:23168
  username: your-account-slug
  password: 'generated SFTP credential password'

  # Optional SSH host-key pin. Without it, the first observed key is trusted
  # and recorded in ~/.rawback/upload-state.json.
  # hostFingerprint: SHA256:base64-fingerprint
```

The SFTP endpoint may contain only a hostname and optional port. Keep the
username and password in their dedicated fields; URL paths, query strings, and
embedded credentials are rejected.

View the stored configuration in YAML or JSON form:

```bash
rawback config view
rawback config view --json
```

Human output also names the environment the current invocation would use.

The command reads only this file; it does not merge environment overrides or
built-in defaults and does not require authentication. YAML comments and unknown
keys remain visible in human output. Both formats replace every `sftp.password` with
`[REDACTED]`, including the ones inside `environments`; open the file directly
when you need to inspect or change the real value.

On Linux and macOS, upload commands reject a config file readable or writable by
group or other users. Fix its permissions with:

```bash
chmod 600 ~/.rawback/config.yml
```

`apiHost` is intended for development or self-hosted environments. Supplying an
API host directly to the programmatic client factory takes precedence over the
value in this file.

### Metadata concurrency

`metadata.concurrency` controls ExifTool workers used by `photos check` and the
local duplicate-check stage of `photos upload`. When omitted, Rawback chooses a
worker count from the number of files, available CPU parallelism, and free and
total memory, with an automatic ceiling of 64 workers.

An explicit value is used exactly, up to the number of files being examined, and
bypasses the memory-aware choice. Higher values may improve large-folder review
on a fast SSD, but they consume more CPU and memory and may reduce throughput on
hard disks or network volumes. Start with automatic mode and change the value in
small steps against representative files. Each CLI invocation rereads the file.

This setting does not control file transfers. `photos upload --concurrency`
continues to select 1 through 16 parallel SFTP transfers.

## Environments

The keys above describe one set of hosts. To keep a local server and production
usable at the same time — signed into both, with no re-authentication when you
switch — add named environments:

```yaml
# The environment later commands use. Omit it to use the top-level keys.
current: production

# Top-level keys are the "default" environment and the base every named
# environment inherits from, so shared settings need to be written only once.
metadata:
  concurrency: 8
sftp:
  username: your-account-slug

environments:
  production:
    apiHost: https://api.rawback.app
    webHost: https://rawback.app
    sftp:
      endpoint: sftp://ftp.rawback.app:23168
      password: 'generated SFTP credential password'

  local:
    apiHost: http://localhost:23164
    webHost: http://localhost:3407
    sftp:
      endpoint: sftp://localhost:23168
      password: 'local SFTP credential password'
```

A named environment accepts exactly the same keys as the top level: `apiHost`,
`webHost`, `metadata`, and `sftp`. `apiHost` and `webHost` replace the top-level
value outright; `metadata` and `sftp` merge key by key, so the shared
`sftp.username` and `metadata.concurrency` above apply to both environments.

`default` is reserved for the top-level keys and is rejected as a name under
`environments:`.

### Choosing one

Highest precedence first:

1. `rawback --env local photos list` — one command only.
2. `current:` in `config.yml`, written by `rawback config use local`.
3. `default`, the top-level keys.

There is no environment variable for this. An unknown name fails and lists the
names that exist rather than quietly falling back.

```bash
rawback config env list          # names, API hosts, and which are signed in
rawback config use local         # save the choice
rawback --env production web     # override it once
```

**Rawback Desktop reads `current:` from this same file**, so `rawback config use`
moves both. Use `--env` when only the CLI should move.

An existing flat `config.yml` with no `environments:` block keeps working
unchanged as the `default` environment.

## Authentication files

Running `rawback auth` opens a 10-minute device approval page in the browser.
After approval it creates `~/.rawback/credentials.json` with an access token and
refresh token. The write is atomic, and the directory and file receive
restrictive permissions on Unix. Do not edit this file by hand or share a
device-approval link.

The file holds one token pair per environment, so signing into one leaves the
others alone:

```jsonc
{
  "version": 2,
  // Mirrors the default environment for older Rawback builds.
  "token": "...",
  "refreshToken": "...",
  "environments": {
    "default": { "token": "...", "refreshToken": "..." },
    "production": { "token": "...", "refreshToken": "..." },
    "local": { "token": "...", "refreshToken": "..." },
  },
}
```

A single-pair file written by an earlier release is read as the `default`
environment and upgraded on the next write, so no re-authentication is needed.

Most commands require authentication. `rawback pricing` is the exception: it can
read public pricing without saved credentials. Check the current session with:

```bash
rawback auth status
```

The status output names the environment and API host it checked. To sign into
another one:

```bash
rawback --env local auth
rawback --env local auth status
```

If a refresh token is still valid, the CLI rotates expired credentials and
retries a failed API request once, writing the rotated pair back into that
environment's slot. If the session cannot be refreshed, sign in again:

```bash
rawback auth --force
```

## Camera connections

`rawback camera connect` records the camera in `~/.rawback/cameras.json`. **The
Rawback desktop app reads and writes the same file**, so pairing in one places
the camera in the other's list too.

```jsonc
{
  "version": 1,
  "default": "192.168.0.1:8080",
  "cameras": [
    {
      "id": "192.168.0.1:8080",
      "host": "192.168.0.1",
      "port": 8080,
      "useTLS": false,
      "name": "Canon EOS R6m2",
      "username": "ccapi",
      "lastUsedAt": "2026-08-04T09:00:00.000Z",
    },
  ],
}
```

The file is written atomically at mode `0600`, inside a `0700` directory, and is
capped at twenty cameras with the least recently used dropped first. Fields the
CLI does not recognise are preserved, so an older build cannot discard what a
newer one saved.

### Camera passwords

A CCAPI password is stored **only** when you pass `--save-password`:

```bash
rawback camera connect 'http://ccapi:secret@192.168.0.1:8080' --save-password
```

It is then held in plain text, exactly as `config.yml` holds `sftp.password`.
Sharing the file with the desktop app rules out encrypting it, because the
desktop's OS-keychain encryption is not readable from a CLI. Camera commands
reject the file if group or others can read it while it holds a password:

```bash
chmod 600 ~/.rawback/cameras.json
```

Without `--save-password` the entry keeps only the user name, and the password
comes from the URL, from `RAWBACK_CAMERA_URL`, or from a prompt.

`rawback camera list` never prints a password, in either output format. Remove a
camera and its saved password with `rawback camera forget <id>`.

### Capability cache

CCAPI requires a discovery step before any endpoint call, and a fresh process
would otherwise repeat it every time. Each saved camera therefore carries a
cached capability map under `discovery`, keyed on the camera's firmware version
and serial number.

The cache is re-read when it is more than seven days old, when `--refresh` is
passed, or when the camera reports an endpoint it previously advertised as
missing — so moving a different body onto the same address fixes itself. The
Digest authentication handshake is deliberately _not_ cached across runs, because
its nonce counter must not repeat, so each invocation pays one extra round-trip
when the camera has authentication enabled.

### Self-signed camera certificates

Canon bodies serve HTTPS with a self-signed certificate. `rawback` verifies
certificates by default and reports what to do when verification fails, rather
than trusting silently:

```bash
rawback camera connect https://192.168.0.1 --insecure
```

The choice is remembered for that camera, and `rawback camera list` shows it.
Requests are also pinned to the camera's hostname, so a relaxed certificate check
cannot follow a redirect elsewhere. `--insecure` is rejected for an `http://`
target, where there is no TLS to relax.

## SFTP credential setup

SFTP credentials are separate from the tokens used for API authentication.

1. Run `rawback auth status` and note the slug on the `Profile` line.
2. Create a named credential with `rawback cred add --name "My computer"`.
3. Copy the one-time password into `sftp.password` in `config.yml`.
4. Put the profile slug in `sftp.username`.
5. Set the file to mode `0600` on Unix.

SFTP credentials are per environment, because each one has its own server and
its own account. Put them under that environment's `sftp:` block and run the
setup commands with the matching `--env`.

The server chooses the SFTP password; it cannot be supplied or changed through
the CLI. `rawback cred list` never displays existing passwords. If a password is
lost, delete that credential and create another:

```bash
rawback cred list
rawback cred del 7
rawback cred add --name "Replacement credential"
```

Deleting a credential asks for confirmation. Use `--force` only for an
intentional non-interactive deletion.

## Upload behavior

Always preview a large upload first:

```bash
rawback photos upload --path /path/to/photos --dry-run
```

The dry run authenticates, validates configuration and account quota, scans the
input, and checks exact remote upload identities. It does not open an SFTP connection or
modify upload state. Its time estimate uses matching local upload
history when available and otherwise uses a clearly labeled 10 Mbps fallback.

Start the upload after reviewing the totals:

```bash
rawback photos upload --path /path/to/photos --concurrency 4
```

Transfer concurrency defaults to `4` and accepts integers from `1` through `16`. All

While an upload is running in an interactive terminal, the CLI shows aggregate
bytes and files, transfer speed, ETA, and up to four active filenames. When
stdout is redirected, it emits line-oriented file status and a final summary
instead of terminal animation.
workers share one SFTP connection.

Before connecting, the CLI verifies:

- The local path is a regular file or directory and not a symbolic link.
- Recursively discovered files have supported extensions.
- At least one supported image or RAW file is found.
- The authenticated account slug matches `sftp.username`.
- The account has at least one enabled SFTP credential.
- A remote photo is skipped only when its filename and EXIF capture time both match.
- The pending bytes fit in the account's remaining storage quota.

Capture metadata is extracted locally with the bundled ExifTool runtime. Unless
`metadata.concurrency` is configured, the extractor automatically chooses up to
twice the available CPU parallelism while accounting for free and total memory,
without treating reclaimable system cache as unavailable RAM. Automatic
concurrency has a ceiling of 64 worker processes.
Files without usable capture metadata upload normally. If local extraction or
the API duplicate query is unavailable, the check fails open and the SFTP
service remains the authoritative duplicate guard. When the selected tree
contains multiple files with the same filename and capture time, only the first
is queued; files that merely share a basename are kept.

Supported image extensions are `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.tif`,
`.tiff`, `.heic`, `.heif`, `.bmp`, and `.avif`. Supported RAW extensions are
`.cr2`, `.cr3`, `.nef`, `.arw`, `.dng`, `.raf`, `.orf`, `.pef`, `.rw2`, `.srw`,
and `.x3f`. Matching is case-insensitive. Directory scanning skips symbolic
links and unrelated file types, but fails if it finds no supported files.

## Resume state and interruption

Completed uploads are recorded in the portable `~/.rawback/upload-state.json`
shared with Rawback Desktop. On first use, the CLI imports its legacy
`upload-progress.sqlite` records and retains that database for rollback. A later
run skips a completed file only when its canonical path, size, and modification
time still match. Incomplete files restart from the beginning because the SFTP
transport does not append partial content.

On the first `Ctrl-C`, the CLI stops scheduling new files and lets active uploads
finish. Press `Ctrl-C` again to disconnect immediately. Re-run the same command
to continue with remaining files.

Only one upload process may use the same account and SFTP endpoint at a time.
Connection failures are retried with short backoff; individual permanent file
failures are reported in the final summary.

## SFTP host keys

By default, the CLI uses trust on first use: it saves the first observed SFTP host
key in the shared upload-state file and rejects a different key on later
connections. For managed environments, set `sftp.hostFingerprint` to the
expected SHA-256 fingerprint instead.

Verify the fingerprint through a trusted Rawback channel before pinning it. Do
not delete the upload-state file merely to bypass a host-key mismatch; investigate
the server or network change first.

## Troubleshooting

### Device authorization is temporarily unavailable

The CLI retries temporary network and server failures while creating the device
session. If all three attempts fail, retry later and include the displayed trace
ID when reporting the problem. Server operators should check the API `/ready`
endpoint and its Redis connection; existing credentials are not replaced by a
failed authentication attempt. Device-authentication failures include the raw
server error, which may contain infrastructure-specific Redis, network, or ACL
details.

### `Missing sftp... for the <name> environment in ~/.rawback/config.yml`

Add the missing `endpoint`, `username`, or `password` field under the `sftp`
mapping of the named environment, or under the top-level `sftp:` block if the
value is shared. YAML indentation matters.

### `Unknown environment "..." in ~/.rawback/config.yml`

The `--env` name or the saved `current:` value has no entry under
`environments:`. The message lists the names that do exist; `rawback config env
list` shows the same set with their API hosts.

### `Config ... must not be accessible by group or others`

Run `chmod 600 ~/.rawback/config.yml`, then retry.

### Config username does not match the authenticated account

Run `rawback auth status` and copy the slug after `Profile: @` into
`sftp.username`. If the wrong account is signed in, run `rawback auth --force`.

### No enabled SFTP credential

Create one with `rawback cred add`. If one is listed but disabled, create a new
credential or correct its status through Rawback before retrying.

### Duplicate checking is unavailable

The CLI warns and continues uploading when EXIF extraction or the API identity
query fails. The SFTP service performs the authoritative duplicate check, so no
file is discarded solely because the preflight optimization was unavailable.

### Host-key mismatch

Stop and verify whether the Rawback SFTP host key intentionally changed. A
mismatch can also indicate that traffic is reaching the wrong server.
