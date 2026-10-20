#!/usr/bin/env bash
# The Box image's manifest (v1.16 ticket 07, ob-m73k): the tools the image ships and the version each one reports, written as
# JSON to the path given first. The Dockerfile runs this last. infra/box-tools.ts reads the file from the built image and
# generates docs/box.md's tool list from it. A tool whose version command fails, or reports no version, fails the build.
set -eu

out="$1"
records="$(mktemp)"
trap 'rm -f "$records"' EXIT

# program NAME COMMAND VERSION_ARG...: runs COMMAND with VERSION_ARG and records the first dotted version in its output,
# or else the first number on its first line (less prints "less 590").
program() {
  local name="$1" command="$2"
  shift 2
  local text line version
  text="$("$command" "$@" 2>&1)" || { echo "box-manifest: '$command $*' failed for $name" >&2; exit 1; }
  line="$(head -n 1 <<< "$text")"
  version="$(grep -oE '[0-9]+(\.[0-9]+)+' <<< "$text" | head -n 1 || true)"
  if [ -z "$version" ]; then version="$(grep -oE '[0-9]+' <<< "$line" | head -n 1 || true)"; fi
  if [ -z "$version" ]; then echo "box-manifest: no version for $name in: $line" >&2; exit 1; fi
  jq -nc --arg name "$name" --arg command "$command" --arg version "$version" '{kind: "program", name: $name, command: $command, version: $version}' >> "$records"
}

# release NAME COMMAND REPORTED VERSION: a tool whose binary reports an older version than its release (the sd 1.1.0 release prints
# "sd 1.0.0"). It runs COMMAND --version, requires REPORTED as its first line and records VERSION, the release the Dockerfile installs.
# Another release reports another line and fails the build here, so the version recorded cannot drift from the one installed.
release() {
  local name="$1" command="$2" reported="$3" version="$4" line
  line="$("$command" --version 2>&1 | head -n 1)"
  if [ "$line" != "$reported" ]; then echo "box-manifest: $name reports '$line', not '$reported': write the release it is here" >&2; exit 1; fi
  jq -nc --arg name "$name" --arg command "$command" --arg version "$version" '{kind: "program", name: $name, command: $command, version: $version}' >> "$records"
}

# package NAME: records the installed version of a Python distribution.
package() {
  local name="$1" version
  version="$(pip3 show "$name" 2>/dev/null | sed -n 's/^Version: //p')"
  if [ -z "$version" ]; then echo "box-manifest: Python package $name is not installed" >&2; exit 1; fi
  jq -nc --arg name "$name" --arg version "$version" '{kind: "package", name: $name, version: $version}' >> "$records"
}

# ws has no version flag; its help must run, which proves the bundled program starts.
ws --help > /dev/null 2>&1 || { echo "box-manifest: ws --help failed" >&2; exit 1; }

program ripgrep rg --version
program fd fd --version
program jq jq --version
release sd sd 'sd 1.0.0' 1.1.0
program less less --version
program tree tree --version
program file file --version
program tar tar --version
program gzip gzip --version
program xz xz --version
program zip zip -v
program unzip unzip -v
program zstd zstd --version
program curl curl --version
program wget wget --version
program sqlite3 sqlite3 --version
program ffmpeg ffmpeg -version
program imagemagick convert -version
program poppler pdftotext -v
program gcc gcc --version
program git git --version
program iproute2 ip -V
program procps ps --version
program node node --version
program bun bun --version
program pnpm pnpm --version
program uv uv --version
program python3 python3 --version

package pandas
package numpy
package matplotlib
package ipython
package pillow
package requests
package httpx
package openpyxl
package python-docx
package pypdf
package beautifulsoup4
package lxml
package pyyaml
package polars
package yq

jq -s '{manifest: 1, tools: .}' "$records" > "$out"
