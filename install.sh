#!/bin/sh
set -eu

RELEASE_BASE_URL="${RAWBACK_RELEASE_BASE_URL:-https://github.com/rawback-app/cli/releases/latest/download}"
INSTALL_DIR="${RAWBACK_INSTALL_DIR:-${HOME:?HOME is not set}/.local/bin}"

fail() {
  echo "rawback installer: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    asset_os="Darwin"
    ;;
  Linux)
    asset_os="Linux"
    ;;
  *)
    fail "unsupported operating system: $os"
    ;;
esac

case "$arch" in
  x86_64 | amd64)
    asset_arch="x86_64"
    ;;
  arm64 | aarch64)
    asset_arch="arm64"
    ;;
  *)
    fail "unsupported architecture: $arch"
    ;;
esac

command -v tar >/dev/null 2>&1 || fail "tar is required"

if command -v sha256sum >/dev/null 2>&1; then
  checksum_command="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  checksum_command="shasum"
else
  fail "sha256sum or shasum is required"
fi

archive="rawback_${asset_os}_${asset_arch}.tar.gz"
release_base_url="${RELEASE_BASE_URL%/}"
temporary_directory="$(mktemp -d 2>/dev/null || mktemp -d -t rawback-install)" ||
  fail "could not create a temporary directory"
staged_binary=""

cleanup() {
  if [ -n "$staged_binary" ]; then
    rm -f "$staged_binary"
  fi
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

archive_path="$temporary_directory/$archive"
checksums_path="$temporary_directory/checksums.txt"

echo "Downloading $archive..."
curl -fL --retry 3 --output "$archive_path" "$release_base_url/$archive" ||
  fail "failed to download $archive"
curl -fL --retry 3 --output "$checksums_path" "$release_base_url/checksums.txt" ||
  fail "failed to download checksums.txt"

expected_checksum="$(
  awk -v filename="$archive" '$2 == filename || $2 == "*" filename { print $1; exit }' "$checksums_path"
)"
[ -n "$expected_checksum" ] || fail "checksums.txt does not contain $archive"

if [ "$checksum_command" = "sha256sum" ]; then
  actual_checksum="$(sha256sum "$archive_path" | awk '{ print $1 }')"
else
  actual_checksum="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
fi

expected_checksum="$(printf '%s' "$expected_checksum" | tr '[:upper:]' '[:lower:]')"
actual_checksum="$(printf '%s' "$actual_checksum" | tr '[:upper:]' '[:lower:]')"
[ "$actual_checksum" = "$expected_checksum" ] ||
  fail "checksum mismatch for $archive"

tar -xzf "$archive_path" -C "$temporary_directory" ||
  fail "failed to extract $archive"
source_binary="$temporary_directory/rawback"
[ -f "$source_binary" ] || fail "archive does not contain the rawback binary"

mkdir -p "$INSTALL_DIR" || fail "could not create $INSTALL_DIR"
staged_binary="$INSTALL_DIR/.rawback.$$.tmp"
cp "$source_binary" "$staged_binary" || fail "could not stage rawback in $INSTALL_DIR"
chmod 0755 "$staged_binary" || fail "could not mark rawback executable"
mv -f "$staged_binary" "$INSTALL_DIR/rawback" || fail "could not install rawback"
staged_binary=""

echo "Installed rawback to $INSTALL_DIR/rawback"
"$INSTALL_DIR/rawback" --version

case ":${PATH:-}:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Warning: $INSTALL_DIR is not on PATH; add it before running rawback." >&2
    ;;
esac
