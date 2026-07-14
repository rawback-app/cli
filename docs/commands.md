# Command reference

Run `rawback <command> --help` for the version-specific help installed on your
machine. Unknown commands and options are rejected.

## Global options

| Option            | Description                       |
| ----------------- | --------------------------------- |
| `-h`, `--help`    | Show help for the current command |
| `-V`, `--version` | Print the CLI version             |

Running `rawback` without arguments shows top-level help.

## `rawback auth [status]`

Sign in interactively:

```bash
rawback auth
```

If a valid session already exists, the command asks before replacing it.
`--force` skips both the current-session check and replacement confirmation.
Omitted email and password values are prompted for.

| Option                  | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `--email <email>`       | Supply the login email                                            |
| `--password <password>` | Supply the login password                                         |
| `--force`               | Reauthenticate without checking or confirming the current session |

For non-interactive login, all three options are needed:

```bash
rawback auth --email user@example.com --password 'secret' --force
```

Passing a password on the command line may expose it in shell history or process
listings. Prefer the interactive prompt whenever possible.

Check the stored session and display account information:

```bash
rawback auth status
```

Login options are not accepted by `auth status`.

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

## `rawback photos list`

Lists the authenticated photo library as a table, or as a `photos` and
`pageInfo` JSON object with `--json`.

```bash
rawback photos list [options]
```

| Option                        | Description                                | Default |
| ----------------------------- | ------------------------------------------ | ------- |
| `--search <text>`             | Search filenames and photo metadata        | —       |
| `--status <value>`            | Filter by photo status                     | —       |
| `--camera-make <value>`       | Filter by camera make                      | —       |
| `--camera-model <value>`      | Filter by camera model                     | —       |
| `--lens-model <value>`        | Filter by lens model                       | —       |
| `--captured-after <time>`     | ISO date/time or Unix timestamp in seconds | —       |
| `--captured-before <time>`    | ISO date/time or Unix timestamp in seconds | —       |
| `--aperture-min <number>`     | Minimum aperture                           | —       |
| `--aperture-max <number>`     | Maximum aperture                           | —       |
| `--focal-length-min <number>` | Minimum focal length in millimeters        | —       |
| `--focal-length-max <number>` | Maximum focal length in millimeters        | —       |
| `--rate <0-5>`                | Include one or more ratings                | `3,4,5` |
| `--city <value>`              | Filter by city                             | —       |
| `--country <value>`           | Filter by country                          | —       |
| `--has-gps`                   | Include only photos with GPS coordinates   | `false` |
| `--page <number>`             | Positive result page                       | `1`     |
| `--page-size <number>`        | Results per page, from 1 through 100       | `24`    |
| `--json`                      | Print machine-readable JSON                | `false` |

Multi-value options can be repeated or comma-separated:

```bash
rawback photos list --status completed --status processing
rawback photos list --camera-make Canon,Sony --rate 4,5
```

Photo statuses are `pending`, `processing`, `completed`, and `failed`.

Minimum values cannot exceed their corresponding maximum values. Capture dates
must form a valid chronological range.

## `rawback photos upload`

Uploads one supported file or recursively scans and uploads a directory:

```bash
rawback photos upload --path <file-or-directory> [options]
```

| Option                   | Description                                                 | Default |
| ------------------------ | ----------------------------------------------------------- | ------- |
| `--path <path>`          | Required file or directory                                  | —       |
| `--concurrency <number>` | Parallel uploads; integer from 1 through 16                 | `4`     |
| `--dry-run`              | Report pending/skipped files, bytes, and estimated duration | `false` |

Upload setup and safety behavior are covered in
[Configuration and uploads](configuration.md).

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

Shows storage, AI credits, face recognition, daily trends, top images, recent AI
operations, and operation costs:

```bash
rawback usage [--json]
```

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

The CLI exits with status `0` on success, `1` for validation, API, filesystem, or
upload failures, and `130` when an interactive prompt is cancelled. Scripts
should check the exit status before consuming output.
