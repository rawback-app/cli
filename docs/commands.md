# Command reference

Run `rawback <command> --help` for the version-specific help installed on your
machine. Unknown commands and options are rejected.

## Global options

| Option            | Description                                   |
| ----------------- | --------------------------------------------- |
| `-h`, `--help`    | Show help for the current command             |
| `-V`, `--version` | Print the CLI version                         |
| `--env <name>`    | Run against one environment from `config.yml` |

Running `rawback` without arguments shows top-level help.

`--env` accepts any name under `environments:` in `~/.rawback/config.yml`, plus
the reserved name `default` for the file's top-level settings. Without it,
commands use the saved `current:` environment. An unknown name fails and lists
the names that do exist. See
[Configuration](configuration.md#environments) for the file format.

## `rawback auth [status]`

Sign in through the browser:

```bash
rawback auth
```

If a valid session already exists, the command asks before replacing it.
`--force` skips both the current-session check and replacement confirmation.

| Option    | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `--force` | Reauthenticate without checking or confirming the current session |

The CLI creates a device session that expires after 10 minutes, prints its
approval URL, and attempts to open it in the system browser. The URL remains
usable if the browser cannot be opened automatically. After you sign in and
approve the request, the CLI checks the session every 10 seconds and stores the
issued credentials. Denied, expired, and already-used sessions do not replace
existing credentials. Network and server failures while creating the session
are retried up to three total attempts. A persistent server failure includes a
trace ID when the API provides one and the raw server error returned by the
device-authentication endpoint.

Check the stored session and display account information:

```bash
rawback auth status
```

`--force` is not accepted by `auth status`.

Both commands act on one environment: `rawback --env local auth` signs into
`local` and leaves every other environment's tokens untouched, and
`rawback --env local auth status` reports that environment's session. The status
output names the environment and the API host it queried.

## `rawback config view`

Displays the stored `~/.rawback/config.yml` without requiring authentication:

```bash
rawback config view [--json]
```

Human output retains YAML comments and unknown keys, and names the environment
the current invocation would use along with its API host. `--json` converts the
stored mapping to machine-readable JSON and writes no additional prose to
stdout. Both formats replace every `sftp.password` with `[REDACTED]`, including
the ones inside `environments`, and do not include environment overrides or
built-in defaults. A missing or empty optional file is reported as an empty
configuration; malformed or unreadable files fail with a nonzero exit status.

## `rawback config env list`

Lists the environments defined in `~/.rawback/config.yml`:

```bash
rawback config env list [--json]
```

Each row shows the environment name, its resolved API host, whether
`credentials.json` holds a token pair for it, and which one this invocation
would use. The reserved `default` environment is always listed. Like
`config view`, this command does not require authentication.

## `rawback config use`

Saves the environment later commands should use, without a flag:

```bash
rawback config use local
```

This writes `current:` into `~/.rawback/config.yml`, preserving comments and
every other key. The name must already exist under `environments:`, or be
`default`; anything else fails and lists the valid names. **Rawback Desktop
reads the same setting**, so it follows this choice on its next launch — use
`--env` instead for a one-off command that should not move Desktop.

## `rawback credentials`

Manage upload credentials. `credentials` can be shortened to `cred`, and
`delete` can be shortened to `del`.

```bash
rawback cred list
rawback cred add --name "Laptop"
rawback cred del 7
```

### `list`

Lists ID, name, status, creation time, and last-used time. Existing passwords are
never returned.

```bash
rawback cred list [--json]
```

### `add`

Creates a server-generated password and shows it once. The name is prompted for
when omitted and may contain up to 50 characters.

```bash
rawback cred add [--name <name>] [--json]
```

### `delete`

Deletes the positive numeric credential ID after confirmation:

```bash
rawback cred delete <id> [--force] [--json]
```

`--force` skips confirmation and is required for non-interactive deletion.

## `rawback camera`

Controls a Canon camera over CCAPI, where the camera is the HTTP server. Enable
CCAPI in the camera's Wi-Fi menu before the first connection.

```bash
rawback camera <command> [options]
```

### Camera targets

Every camera command resolves its target in this order:

1. the `connect` positional URL
2. `--camera <url>`
3. the `RAWBACK_CAMERA_URL` environment variable (an empty value counts as unset)
4. the saved default in `~/.rawback/cameras.json`

| Option           | Purpose                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--camera <url>` | `http://user:password@192.168.0.1:8080`. A password containing `@` or `:` must be percent-encoded (`%40`, `%3A`).      |
| `--insecure`     | Accept the camera's self-signed TLS certificate. Only valid for an `https://` target, and remembered per saved camera. |
| `--timeout <ms>` | Per-request deadline, default `12000`. `0` disables it.                                                                |
| `--refresh`      | Ignore the cached capability map and re-read it from the camera.                                                       |
| `--json`         | Machine-readable output.                                                                                               |

Connecting reads the camera's capability map and caches it, so later commands
skip four round-trips. The cache is keyed on firmware and serial: swap a
different body onto the same address and it is replaced automatically.

### `camera connect`

```bash
rawback camera connect [url] [--name <label>] [--save-password] [--no-default] [--json]
```

Verifies the camera, saves it, and makes it the default target. `--save-password`
writes the CCAPI password to `~/.rawback/cameras.json` in plain text; without it
only the user name is stored.

### `camera list`, `camera use`, `camera forget`

```bash
rawback camera list [--json]
rawback camera use <id> [--json]
rawback camera forget <id> [--force] [--json]
```

These read and write the saved-camera file only, so they work with no camera
present. `list` never prints a password. `forget` asks for confirmation unless
`--force` is given.

### `camera info`, `camera status`

```bash
rawback camera info [--json]
rawback camera status [--json]
```

`info` reports model, firmware, serial, lens, and storage. `status` reports
battery, temperature, current storage and directory, and remaining capacity.
Anything the camera does not advertise comes back as `null` and is named in the
`unsupported` array rather than failing the command.

### `camera shoot`

```bash
rawback camera shoot [--af|--no-af] [--manual <half_press|full_press|release>] [--force] [--json]
```

Releases the shutter. Accumulated events are cleared first, so `addedContents`
in the response names the file this command produced. Confirms first unless
`--force`; `--json` requires `--force`, because a script cannot answer a prompt.

### `camera settings`

```bash
rawback camera settings list [--json]
rawback camera settings get <name> [--json]
rawback camera settings set <name> <value> [--int] [--force] [--json]
```

`get` returns `value` plus either `ability` (a list of choices) or `range`
(`min`, `max`, `step`). Settings whose ability is a range — the colour
temperatures, focus-bracketing shot count and increment, and sound-recording
levels — are read as ranges automatically, so a locked setting reports `null`
rather than `0`. `set` writes the value and reads back what the camera accepted.

### `camera contents`

```bash
rawback camera contents storages [--json]
rawback camera contents dirs <storage> [--json]
rawback camera contents list <storage> <directory> [--type <t>] [--order <asc|desc>] [--page <n>] [--all] [--json]
rawback camera contents info <locator> [--json]
rawback camera contents get <locator> --output <path> [--kind <main|thumbnail|display|embedded>] [--overwrite] [--json]
rawback camera contents delete <locator> [--force] [--json]
```

A **locator** is the string the camera returns from `contents list`; pass it back
verbatim. Newer bodies insert an extra path segment, which the CLI handles for
you.

`get` streams to disk rather than buffering, so a RAW file costs no memory. Point
`--output` at a directory to keep the camera's own filename. An existing file is
never replaced without `--overwrite`. `--all` streams every page instead of one.

### `camera liveview`

```bash
rawback camera liveview start [--size <off|small|medium>] [--display <on|keep|off>] [--force] [--json]
rawback camera liveview frame <output> [--json]
rawback camera liveview stream --output-dir <dir> [--frames <n>] [--duration <s>] [--json]
rawback camera liveview stop [--json]
```

`stream` runs until Ctrl-C, `--frames`, or `--duration`, writing numbered JPEGs.
`--output-dir -` writes raw JPEG bytes to stdout instead and cannot be combined
with `--json`. `stop` releases every live-view resource and is safe to run when
the camera is already idle — it is the recovery command after a killed stream.

### `camera events`

```bash
rawback camera events poll [--wait] [--timeout-kind <short|long>] [--json]
rawback camera events watch [--count <n>] [--duration <s>] [--json]
rawback camera events clear [--force] [--json]
```

`watch` streams changes until Ctrl-C, `--count`, or `--duration`. Every event
carries `changedKeys`, which lists every key the camera reported, including ones
the client does not model.

### `camera api`

```bash
rawback camera api --list [--namespace <ns>] [--mutating] [--json]
rawback camera api <id> [--arg key=value ...] [--describe] [--force] [--json]
```

Reaches every catalogued CCAPI endpoint by ID, including ones without a dedicated
command. `--arg` is repeatable and is validated against the endpoint's declared
parameters before any connection is attempted. `--describe` prints an endpoint
without calling the camera. Endpoints that change the camera need `--force` in a
script.

Binary endpoints are not in this catalogue; use `camera contents get`,
`camera liveview frame`, and `camera liveview stream` instead.

### `camera interactive`

```bash
rawback camera interactive
```

A full-screen explorer over the same catalogue: `↑`/`↓` to move, `enter` to run,
`/` to filter, `[`/`]` to scroll a long result, `q` to quit. Requires a terminal;
use `camera api` in scripts. Aliased as `camera tui`.

### Long-running camera commands

`camera liveview stream` and `camera events watch` emit **NDJSON** under `--json`
— one object per frame or event, then a final summary object such as
`{"stopped":true,"frames":183,"seconds":30.2,"reason":"signal"}`. This is a
deliberate exception to the single-document rule, because buffering an unbounded
stream would defeat the purpose; the summary is how a consumer distinguishes a
clean end from a truncated one.

The first Ctrl-C stops the stream, releases the camera, and exits `0` — a
user-requested stop is a success. A second Ctrl-C exits `130` without waiting for
the release, and names the command that will clear it.

### Camera troubleshooting

| Message                                              | Cause                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `The camera ... refused the connection`              | A camera serves one client at a time. Close the Canon app, Rawback Desktop, or a browser tab holding the session. |
| `The camera rejected those credentials`              | The CCAPI user name or password does not match the camera's menu.                                                 |
| `CCAPI is not enabled on this camera`                | Enable CCAPI in the camera menu, then run `rawback camera connect` again.                                         |
| `This camera does not advertise "<endpoint>"`        | The body or firmware does not support it. `rawback camera api --list` shows what it does.                         |
| `The camera's TLS certificate could not be verified` | Expected for a Canon body over HTTPS. Re-run with `--insecure`.                                                   |

## `rawback photos search`

Finds photos by describing them, instead of assembling the filters by hand:

```bash
rawback photos search "from 2012, all images in NYC"
```

The server translates the request into the same structured filters
`rawback photos list` takes, then prints how it read the request above the
results — a summary line plus one field per filter it applied.

| Option                 | Description                                                      | Default |
| ---------------------- | ---------------------------------------------------------------- | ------- |
| `<prompt>`             | What to look for, in plain language (required)                   | —       |
| `--ai-search-id <id>`  | Reuse an earlier interpretation instead of spending an AI credit | —       |
| `--page <number>`      | Positive result page                                             | `1`     |
| `--page-size <number>` | Results per page, from 1 through 100                             | `24`    |
| `--json`               | Print machine-readable JSON                                      | `false` |

Translating a prompt costs one AI credit. The reply carries an `aiSearch.id`,
and passing it back replays that interpretation for free — so paging through a
result set is charged once, not once per page. The command prints the exact
line to run next:

```bash
rawback photos search "from 2012, all images in NYC" --ai-search-id abc123 --page 2
```

Pass the id together with the prompt it came from, never on its own. The server
prefers the id and quietly re-translates the prompt if the id has expired, so a
stale id costs a credit rather than failing the command.

With `--json` the same detail arrives as an `aiSearch` object beside `photos`
and `pageInfo`, so a script can page without re-charging.

Unlike `rawback photos list`, a search applies no default rating filter — a
plain-language request should not be silently narrowed to 3 stars and up. Pass
`--rate` on `photos list` if you want one.

## `rawback photos list`

Lists the authenticated photo library as a table, or as a `photos` and
`pageInfo` JSON object with `--json`.

```bash
rawback photos list [options]
```

| Option                        | Description                                                   | Default |
| ----------------------------- | ------------------------------------------------------------- | ------- |
| `--prompt <text>`             | Plain-language request, combined with the filters below       | —       |
| `--ai-search-id <id>`         | Reuse a previous `--prompt` interpretation (needs `--prompt`) | —       |
| `--search <text>`             | Search filenames and photo metadata                           | —       |
| `--status <value>`            | Filter by photo status                                        | —       |
| `--camera-make <value>`       | Filter by camera make                                         | —       |
| `--camera-model <value>`      | Filter by camera model                                        | —       |
| `--lens-model <value>`        | Filter by lens model                                          | —       |
| `--captured-after <time>`     | ISO date/time or Unix timestamp in seconds                    | —       |
| `--captured-before <time>`    | ISO date/time or Unix timestamp in seconds                    | —       |
| `--aperture-min <number>`     | Minimum aperture                                              | —       |
| `--aperture-max <number>`     | Maximum aperture                                              | —       |
| `--focal-length-min <number>` | Minimum focal length in millimeters                           | —       |
| `--focal-length-max <number>` | Maximum focal length in millimeters                           | —       |
| `--rate <0-5>`                | Include one or more ratings                                   | `3,4,5` |
| `--city <value>`              | Filter by city                                                | —       |
| `--country <value>`           | Filter by country                                             | —       |
| `--has-gps`                   | Include only photos with GPS coordinates                      | `false` |
| `--page <number>`             | Positive result page                                          | `1`     |
| `--page-size <number>`        | Results per page, from 1 through 100                          | `24`    |
| `--json`                      | Print machine-readable JSON                                   | `false` |

Multi-value options can be repeated or comma-separated:

```bash
rawback photos list --status completed --status processing
rawback photos list --camera-make Canon,Sony --rate 4,5
```

Photo statuses are `pending`, `processing`, `completed`, and `failed`.

Minimum values cannot exceed their corresponding maximum values. Capture dates
must form a valid chronological range.

`--prompt` composes with every filter above, and anything you set explicitly
wins over the AI's reading of the prompt. Supplying `--prompt` also drops the
`3,4,5` rating default, for the reason given under
[`rawback photos search`](#rawback-photos-search).

## `rawback photos check`

Checks whether supported local photo and RAW files are already in the
authenticated Rawback library:

```bash
rawback photos check --path <file-or-directory> [--json]
```

| Option          | Description                                              | Default |
| --------------- | -------------------------------------------------------- | ------- |
| `--path <path>` | Required image/RAW file or recursively scanned directory | —       |
| `--json`        | Print a machine-readable result report                   | `false` |

The command reports every discovered file as `present`, `absent`, or `unknown`.
Present files include the matching Rawback image ID. JSON output contains a
`files` array and `summary` counts; unavailable image IDs and reasons are
represented by `null`.

Interactive terminals show staged progress for file scanning, metadata reading,
and the Rawback check. Redirected output remains line-oriented, and `--json`
prints only the machine-readable report.

Matching uses the exact upload identity shared with Rawback Desktop and the
upload service: the local basename plus its EXIF capture time. It is not a
byte-content comparison. A missing capture time, unreadable metadata, or failed
API batch produces an `unknown` result. The complete report is still printed,
but the command exits nonzero when any result is unknown. Finding an existing
photo is a normal successful result.

Directories use the same supported extensions and symlink behavior as
`photos upload`. Metadata workers use the shared `metadata.concurrency` setting
when configured and otherwise use automatic CPU- and memory-aware sizing; see
[Configuration and uploads](configuration.md#metadata-concurrency).

## `rawback photos upload`

Uploads one supported image or RAW file, or recursively scans and uploads a
directory:

```bash
rawback photos upload --path <file-or-directory> [options]
```

| Option                   | Description                                                 | Default |
| ------------------------ | ----------------------------------------------------------- | ------- |
| `--path <path>`          | Required image/RAW file or recursively scanned directory    | —       |
| `--concurrency <number>` | Parallel SFTP transfers; integer from 1 through 16          | `4`     |
| `--dry-run`              | Report pending/skipped files, bytes, and estimated duration | `false` |

Upload setup and safety behavior are covered in
[Configuration and uploads](configuration.md). Unsupported files are skipped
during directory scans; the command fails if the selected path contains no
supported files. Exact duplicates use the filename plus the locally extracted
EXIF capture time; duplicate-check failures do not block the SFTP upload.
Local EXIF workers are controlled separately by `metadata.concurrency` in the
shared configuration file.

## `rawback videos`

Lists, uploads, and manages videos. Videos upload directly to storage rather
than over SFTP: the CLI asks the API for a multipart plan, PUTs each part to a
presigned URL, and then confirms so the record is saved. Parts are read from
disk on demand, so a very large file is never held in memory.

### `videos list`

```bash
rawback videos list [options]
```

| Option                 | Description                   | Default |
| ---------------------- | ----------------------------- | ------- |
| `--page <number>`      | Page number                   | `1`     |
| `--page-size <number>` | Items per page, 1 through 100 | `24`    |
| `--json`               | Output machine-readable JSON  | `false` |

### `videos upload`

```bash
rawback videos upload --file <path> [options]
```

| Option               | Description                                                 | Default |
| -------------------- | ----------------------------------------------------------- | ------- |
| `--file <path>`      | Required video file to upload                               | —       |
| `--thumbnail <path>` | JPEG or PNG to attach as the poster frame                   | —       |
| `--transcript`       | Extract audio for transcription; `--no-transcript` skips it | `true`  |
| `--json`             | Output machine-readable JSON                                | `false` |

Supported containers are `.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.avi`,
`.mpeg`/`.mpg`, `.3gp`, and `.ts`, up to 100 GB. The CLI reads video metadata
and attempts to extract a poster frame and audio locally. Pass `--thumbnail`
to supply your own poster frame. `--no-transcript` skips audio extraction;
the audio cannot be added later.

For each of `ffmpeg` and `ffprobe`, the executable on `PATH` takes precedence
over its bundled copy. If only one is on `PATH`, the other uses its bundled
copy when available. See [video tool setup](configuration.md#video-tools).

### `videos update`

```bash
rawback videos update --id <id> [--title <title>] [--description <text>]
```

At least one of `--title` or `--description` is required. Passing an empty
description clears it.

### `videos delete`

```bash
rawback videos delete --id <id>
```

Deletes the video and its poster frame and releases the storage against the
account quota. This cannot be undone.

## `rawback dream`

Lists, inspects, and retries daily AI-generated photo recaps. Lists contain
dreams owned by the authenticated account; `get` can also inspect a dream shared
directly with that account.

### `dream list`

Lists dream summaries newest first:

```bash
rawback dream list [--page <number>] [--page-size <number>] [--json]
```

| Option                 | Description                            | Default |
| ---------------------- | -------------------------------------- | ------- |
| `--page <number>`      | Positive result page                   | `1`     |
| `--page-size <number>` | Results per page, from 1 through 100   | `30`    |
| `--json`               | Print machine-readable dream summaries | `false` |

JSON output contains `dreams` and `pageInfo` fields. Each summary includes the
dream ID, date, status, title, cover URL, photo count, and creation timestamp.

### `dream get` and `dream view`

Shows complete dream metadata plus a rate-first page of contributing photos.
`view` is an alias of `get`:

```bash
rawback dream get <dream-id> [--page <number>] [--page-size <number>] [--json]
rawback dream view <dream-id> [--page <number>] [--page-size <number>] [--json]
```

| Option                 | Description                              | Default |
| ---------------------- | ---------------------------------------- | ------- |
| `--page <number>`      | Positive contributing-photo page         | `1`     |
| `--page-size <number>` | Photos per page, from 1 through 100      | `24`    |
| `--json`               | Print machine-readable dream information | `false` |

Human output includes status or failure details, stored Markdown, cover
metadata, places, cameras, and a photo table. JSON output contains `dream`,
`photos`, and `pageInfo` fields and normalizes missing values to `null`.

### `dream retry`

Retries a failed dream owned by the authenticated account:

```bash
rawback dream retry <dream-id> [--force] [--json]
```

Retrying can consume 30 AI credits. The command asks for confirmation unless
`--force` is supplied; `--force` is required for non-interactive automation.
The server rejects missing, shared, pending, or completed dreams. JSON output
reports `retried`, `id`, and `status`; a declined retry reports `status: null`
without making an API request.

## `rawback album`

Manages albums belonging to the authenticated account. Album and nested article
commands use numeric album IDs; no user-domain argument is needed.

### `album list`

Lists albums as a table or as an `albums` and `pageInfo` JSON object:

```bash
rawback album list [--search <name>] [--page <number>] [--page-size <number>] [--json]
```

| Option                 | Description                              | Default |
| ---------------------- | ---------------------------------------- | ------- |
| `--search <text>`      | Search non-secret albums by name         | —       |
| `--page <number>`      | Positive result page                     | `1`     |
| `--page-size <number>` | Results per page, from 1 through 100     | `20`    |
| `--json`               | Print machine-readable album information | `false` |

### `album view`

Shows album metadata and a page of its photos:

```bash
rawback album view <album-id> [--page <number>] [--page-size <number>] [--json]
```

The default image page is `1` with `24` images. JSON output contains `album`,
`images`, and `pageInfo` fields.

### `album create`

Creates a non-secret album. The name is required and visibility defaults to
`private`:

```bash
rawback album create --name <name> [options]
```

| Option                  | Description                                        | Default   |
| ----------------------- | -------------------------------------------------- | --------- |
| `--name <name>`         | Required album name, up to 100 characters          | —         |
| `--description <text>`  | Description, up to 500 characters                  | —         |
| `--permission <value>`  | `private`, `protected`, or `public`                | `private` |
| `--tag-id <id>`         | Smart-filter tag ID; repeat or comma-separate      | —         |
| `--date-from <date>`    | Smart-filter start, as YYYY-MM-DD or RFC3339       | —         |
| `--date-to <date>`      | Smart-filter end, as YYYY-MM-DD or RFC3339         | —         |
| `--timezone <timezone>` | IANA timezone used to interpret smart-filter dates | —         |
| `--camera-id <id>`      | Smart-filter camera ID                             | —         |
| `--lens-id <id>`        | Smart-filter lens ID                               | —         |
| `--json`                | Print the created album as machine-readable JSON   | `false`   |

For example:

```bash
rawback album create \
  --name "Iceland" \
  --tag-id 3,8 \
  --date-from 2026-01-01 \
  --date-to 2026-01-31 \
  --timezone Atlantic/Reykjavik
```

### `album edit`

Updates album metadata, cover image, or smart filters. At least one change option
is required:

```bash
rawback album edit <album-id> [options]
```

`album edit` accepts the create metadata options without applying create
defaults, plus these options:

| Option                  | Description                           |
| ----------------------- | ------------------------------------- |
| `--cover-image-id <id>` | Set an owned photo as the album cover |
| `--clear-tags`          | Remove all smart-filter tags          |
| `--clear-date-from`     | Clear the smart-filter start date     |
| `--clear-date-to`       | Clear the smart-filter end date       |
| `--clear-timezone`      | Clear the smart-filter timezone       |
| `--clear-camera`        | Clear the smart-filter camera         |
| `--clear-lens`          | Clear the smart-filter lens           |

A set option and its matching clear option cannot be combined. Supplying one or
more `--tag-id` values replaces the complete smart-filter tag set; use the
`album tag` commands for incremental changes. Pass `--description ""` to clear
the description. Smart-filter changes can temporarily put the album into the
`collecting` state while its photo membership is recalculated.

### `album delete`

Deletes an album after confirmation:

```bash
rawback album delete <album-id> [--force] [--json]
```

`--force` skips confirmation and is required in non-interactive use. JSON output
reports `{ "deleted": <boolean>, "id": <album-id> }`.

### `album refresh`

Re-runs an album's smart filter and recollects its matching photos:

```bash
rawback album refresh <album-id> [--json]
```

Recollection is not destructive, so no confirmation is required. The command
returns as soon as the server accepts the request; the album reports the
`collecting` status while its photo membership is recalculated. JSON output is
the same album object printed by `album create` and `album edit`.

### `album image`

Adds or removes one photo from an album:

```bash
rawback album image add <album-id> <image-id> [--json]
rawback album image remove <album-id> <image-id> [--force] [--json]
```

Removing a photo only changes album membership; it does not delete the photo.
Removal asks for confirmation unless `--force` is supplied.

### `album tag`

Incrementally adds or removes one or more smart-filter tags in one request:

```bash
rawback album tag add <album-id> <tag-id> [tag-id...] [--json]
rawback album tag remove <album-id> <tag-id> [tag-id...] [--json]
```

IDs must be positive integers and duplicates are ignored. Changing tags causes
the album's matching photos to be recalculated.

### `album article list`

Lists the authenticated account's album articles, newest updates first:

```bash
rawback album article list [--page <number>] [--page-size <number>] [--json]
```

The defaults are page `1` and `12` articles per page. JSON output contains
`articles` and `pageInfo`.

### `album article view`

Views the single article associated with an album:

```bash
rawback album article view <album-id> [--content-only | --json]
```

Human output includes article metadata and stored Markdown. `--content-only`
prints only the stored Markdown for round trips through a file or pipe and
cannot be combined with `--json`.

### `album article edit`

Creates an article when the album has none, or updates the existing article:

```bash
rawback album article edit <album-id> \
  [--title <title>] \
  [--content-file <path|->] \
  [--json]
```

At least one of `--title` and `--content-file` is required. Use `-` as the path
to read UTF-8 Markdown from stdin. A title-only edit preserves the current
content and image associations. An empty content file clears both.

Album photos can be embedded with canonical image tokens:

```markdown
![Optional alt text](rawback://image/108)
```

When content is supplied, the CLI extracts valid token IDs in document order,
removes duplicates, and sends them as the article's image associations. The
photo must belong to the album; the service ignores IDs that do not. New
articles start as drafts, while editing an existing article preserves its
status.

One useful round-trip workflow is:

```bash
rawback album article view 42 --content-only > story.md
rawback album article edit 42 --title "Iceland in winter" --content-file story.md
```

### Article status and deletion

Publish, return to draft, or delete the article belonging to an album:

```bash
rawback album article publish <album-id> [--json]
rawback album article unpublish <album-id> [--json]
rawback album article delete <album-id> [--force] [--json]
```

The CLI resolves the backend article ID internally. These commands report an
actionable error when the album has no article. Deletion asks for confirmation
unless `--force` is supplied; JSON deletion output includes `albumId`,
`articleId`, and `deleted`.

## `rawback shares`

Browses direct shares in both directions and manages existing photo or album
link shares. Direct shares grant another Rawback user access to a photo, album,
or dream. Link shares have a public/restricted URL and numeric share ID.

### `shares list`

Lists content you shared by default. Use `--scope with-me` for resources other
users shared directly with you:

```bash
rawback shares list [options]
rawback shares list --scope with-me --type dream
rawback shares list --status archived
```

| Option                 | Description                                                 | Default  |
| ---------------------- | ----------------------------------------------------------- | -------- |
| `--scope <value>`      | `by-me` or `with-me`                                        | `by-me`  |
| `--type <value>`       | `photo`, `album`, or `dream`                                | —        |
| `--kind <value>`       | Outgoing `link` or `direct` shares                          | —        |
| `--status <value>`     | Outgoing `active` or `archived` shares                      | `active` |
| `--enabled`            | Include only enabled link shares                            | —        |
| `--no-enabled`         | Include only disabled link shares                           | —        |
| `--access <value>`     | Link access type: `public` or `restricted`                  | —        |
| `--expiry <value>`     | Link expiration: `valid`, `expired`, or `never`             | —        |
| `--after <time>`       | Created on/after an ISO value or Unix timestamp in seconds  | —        |
| `--before <time>`      | Created on/before an ISO value or Unix timestamp in seconds | —        |
| `--page <number>`      | Positive result page                                        | `1`      |
| `--page-size <number>` | Results per page, from 1 through 100                        | `20`     |
| `--json`               | Print `{ scope, shares, pageInfo }` JSON                    | `false`  |

Dates apply to when the share or direct grant was created. A date without a
time covers the corresponding UTC day, and both boundaries are inclusive.
Filters unsupported by the API are applied after loading matching pages so
filtered totals and pagination remain accurate.

Incoming shares are always direct, while archived, enabled, access, and expiry
filters apply only to outgoing link shares. Dreams can be shared directly but
cannot have link shares. Incompatible combinations fail before an API request.

### `shares get` and `shares view`

Shows an existing link share's resource, URL, access settings, enabled/archive
state, expiration, permissions, views, and recipient count. `view` is an alias
of `get`:

```bash
rawback shares get <share-id> [--json]
rawback shares view <share-id> [--json]
```

### Link state actions

Archive, restore, enable, or disable a numeric link share ID:

```bash
rawback shares archive <share-id> [--json]
rawback shares unarchive <share-id> [--json]
rawback shares enable <share-id> [--json]
rawback shares disable <share-id> [--json]
```

Archiving is organizational and does not disable the URL. Likewise, enabling or
disabling a share does not change its archive status. Expired shares cannot be
enabled; changing their expiration remains available in the web application.

### Recipients and links

List the email recipients associated with a restricted link share, or print its
URL:

```bash
rawback shares recipients <share-id> [--json]
rawback shares link <share-id> [--copy] [--json]
```

Recipient output includes recipient ID, email, added time, and last access time;
access tokens are never exposed. `shares link` prints only the raw URL unless
`--copy` or `--json` is used. Clipboard copying uses `pbcopy` on macOS,
`clip.exe` on Windows, or an installed `wl-copy`, `xclip`, or `xsel` on Linux.

### `shares delete`

Permanently removes a link share and its email recipients:

```bash
rawback shares delete <share-id> [--force] [--json]
```

Deletion asks for confirmation. `--force` skips confirmation and is required in
non-interactive use. JSON reports `{ "deleted": <boolean>, "id": <share-id> }`.

## `rawback uploads`

Lists FTP and SFTP upload sessions:

```bash
rawback uploads [options]
```

| Option                 | Description                                   | Default |
| ---------------------- | --------------------------------------------- | ------- |
| `--status <status>`    | `in_progress`, `completed`, or `failed`       | —       |
| `--page <number>`      | Positive result page                          | `1`     |
| `--page-size <number>` | Results per page, from 1 through 100          | `20`    |
| `--json`               | Print an `uploads` and `pageInfo` JSON object | `false` |

## `rawback usage`

Shows a compact overview of the account: tier, and a quota meter for storage, AI
credits, and face recognition with the amount remaining and the next reset date.
Meters turn yellow past 90% and red once a quota is reached.

```bash
rawback usage [--detail] [--json]
```

Add `--detail` for the last 30 days of storage, AI credit, and face recognition
activity as terminal charts, plus the largest photos, recent AI operations,
operation costs, and top face matches.

| Option     | Description                                                | Default |
| ---------- | ---------------------------------------------------------- | ------- |
| `--detail` | Add daily charts, recent AI operations, and top lists      | `false` |
| `--json`   | Print a full `usage` JSON object; unaffected by `--detail` | `false` |

## `rawback pricing`

Shows Rawback plans and add-ons. This command does not require authentication.

```bash
rawback pricing [--interval all|month|year] [--json]
```

The default interval is `all`. Free plans remain visible when filtering monthly
or yearly plans.

## `rawback web`

Validates the session and opens the authenticated profile in the system browser:

```bash
rawback web
```

The URL uses `webHost` from `~/.rawback/config.yml`, or
`https://rawback.app` by default.

## Scripting and exit behavior

Use `--json` when available instead of parsing human-readable tables. JSON is
written to standard output. Errors and warnings are written to standard error.
Human output uses responsive Ink layouts, so lower-priority table columns may be
omitted in narrow terminals, and charts and quota meters scale to the terminal
width. Human output is also the only thing `rawback usage --detail` changes: the
`--json` payload is always complete. Interactive terminals show transient activity
indicators; redirected output is deterministic and contains no cursor-control
sequences. JSON, `--content-only`, and version output are never decorated with
icons or prose.

The CLI exits with status `0` on success, `1` for validation, API, filesystem, or
upload failures, and `130` when an interactive prompt is cancelled. Scripts
should check the exit status before consuming output.
