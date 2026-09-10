#!/usr/bin/env bash
set -euo pipefail

pnpm run build

package_dir="$(pwd)/packages/cli"
tmp_dir="$(mktemp -d)"
#trap 'rm -rf "$tmp_dir"' EXIT

commit_hash="$(git rev-parse --verify HEAD | cut -c1-6)"
pack_dir="$tmp_dir/package"
mkdir -p "$pack_dir"
cp -R "$package_dir/." "$pack_dir/"
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const suffix = process.argv[2];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  delete manifest.devDependencies?.["@figctx/core"];
  manifest.version = `${manifest.version}-${suffix}`;
  fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
' "$pack_dir/package.json" "$commit_hash"

pnpm --dir "$pack_dir" pack --pack-destination "$tmp_dir"
tarball="$(find "$tmp_dir" -maxdepth 1 -name '*.tgz' -print -quit)"

pnpm remove --global figctx 2>/dev/null || true
pnpm add --global --force "$tarball"
