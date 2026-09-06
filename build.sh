#!/usr/bin/env bash
set -euo pipefail

pnpm build

package_dir="$(pwd)/packages/cli"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

npm pack "$package_dir" --pack-destination "$tmp_dir" --silent
tarball="$(find "$tmp_dir" -maxdepth 1 -name '*.tgz' -print -quit)"

npm install --global "$tarball"
