# fig-local-context

`fig-local-context` turns a locally exported Figma `.fig` file into a stable,
agent-ready context bundle. It runs entirely on the machine that owns the
export: there are no Figma API calls, MCP calls, browser automation, or remote
services during extraction.

The project is designed for implementation agents that need trustworthy design
facts such as layer hierarchy, text, dimensions, auto-layout, color, typography,
effects, z-order, and embedded asset paths. It prioritizes useful context over
pixel-perfect rendering.

## Status

The CLI and local MCP server are implemented. The current compatibility target
is normal Figma **Save local copy** exports: ZIP archives containing
`meta.json`, `canvas.fig`, a thumbnail, and optional `images/` entries. The
`canvas.fig` payload is decoded locally from Figma's Kiwi binary format.

The initial compatibility target is the `fig-kiwi` canvas signature. The format
is an undocumented Figma implementation detail, so compatibility is deliberately
versioned and unsupported variants fail explicitly instead of being guessed.

## Commands

```sh
figctx extract design.fig --out .figctx/design
figctx inspect .figctx/design --node <node-id>
figctx pack .figctx/design --node <node-id> --format codex
figctx render .figctx/design --node <node-id> > artwork.svg
```

## Install and use

Requires Node.js 20+ and pnpm. From a checkout:

```sh
pnpm install
pnpm build
node packages/cli/dist/main.js extract design.fig --out .figctx/design
node packages/cli/dist/main.js inspect .figctx/design --node '1-2'
node packages/cli/dist/main.js pack .figctx/design --node 'https://www.figma.com/design/file/name?node-id=1-2' --format codex
node packages/cli/dist/main.js render .figctx/design --node '1-2' > artwork.svg
```

### Pixel-validation workflow

Save an exported PNG for each frame that needs visual parity, then attach it
to its local canonical node ID. All steps are local and make no Figma request:

```sh
# Refuse pixel-perfect work early if a required local font is missing.
figctx font-check .figctx/design --font-dir ./fonts

# Attach the PNG exported from that frame in Figma.
figctx reference .figctx/design --node '320-182023' --image ./references/mobile-page.png

# After implementation, compare a local browser screenshot to the reference.
figctx compare .figctx/design --node '320-182023' --candidate ./screenshots/mobile-page.png
```

`reference` stores a PNG in `references/` with its dimensions and SHA-256.
`compare` writes `comparisons/<node-id>/diff.png` and `report.json`, including
the mismatch pixel count and ratio. `pack` and MCP `get_frame_bundle` return
all references attached within the requested subtree.

`--node` accepts canonical bundle IDs (`1:2`), Figma URL IDs (`1-2`), and a
Figma URL containing `node-id`. Resolution is local to the extracted bundle;
it never requests the linked Figma file. When the local export carries an
`originFileKey`, a URL with `/design/<file-key>/` or `/file/<file-key>/` must
match it; a URL for another Figma file fails with
`NODE_REFERENCE_FILE_MISMATCH` before a node is returned.

`pack --format codex` returns the selected node's complete depth-first subtree,
descendant text, deduplicated image/vector references, available maximal
vector-only groups, and every style token used by that subtree. Use `render`
with one listed group ID to receive a single self-contained SVG; it does not
write to the bundle. This is the intended command for an agent implementing a
whole section or page, while `inspect` remains a concise single-node lookup.

Start the MCP server after extraction:

```sh
node packages/mcp-server/dist/main.js --root .figctx/design
```

It exposes `list_frames`, `get_node_context`, `get_frame_bundle`,
`get_vector_svg`, `get_style_tokens`, and `get_asset` via stdio. Node and frame responses include
attached reference metadata when present. The server reads only bundle files
and does not open the source `.fig` or use the network.

`get_frame_bundle` uses the same full-subtree contract as `figctx pack`.

`extract` creates a self-contained bundle. `inspect` and `pack` read that bundle
only; they do not need to reopen the original `.fig` file.

```text
.figctx/design/
├── manifest.json
├── document.raw.json
├── document.agent.json
├── tokens/
│   ├── colors.json
│   ├── typography.json
│   ├── effects.json
│   └── fonts.json
├── assets/images/
├── assets/images.json
├── assets/thumbnail.png
├── assets/vectors.json
├── assets/vectors/
│   ├── vector-network-<id>.svg
│   └── vector-network-<id>.bin.gz
├── references/index.json
├── references/<node-id>.png
├── comparisons/<node-id>/report.json
├── comparisons/<node-id>/diff.png
└── frames/<node-id>/context.md
```

### Bundle files

- `manifest.json` records the source file name and SHA-256, parser and contract
  versions, detected variants, extraction status, and warnings.
- `document.raw.json` is the decoded Kiwi document for diagnostics. Large binary
  blobs remain files or references, not base64 JSON payloads.
- `document.agent.json` is the stable normalized layer tree. Nodes retain IDs,
  names, type, parent/child ordering, absolute bounds, transforms, visibility,
  opacity, masks and frame clipping flags, constraints, layout details, paints, effects, text, Figma-computed
  text layout metrics (baselines and font metadata), and asset/vector
  references.
- `tokens/` contains deduplicated colors, typography, and effects, each with
  the source node IDs that produced it.
- `tokens/fonts.json` records required font family, style, PostScript name,
  observed weight, and source node IDs. It never copies licensed system fonts.
- `assets/images/` contains extracted raster assets with extensions inferred
  from their real byte signatures, not from Figma's extensionless filenames.
- `assets/images.json` maps every original image hash to its local, inferred
  path. When present in the export, `assets/thumbnail.png` is retained as the
  unmodified document-level visual baseline for implementation review.
- `assets/vectors/` retains the original Kiwi vector-network blobs and, when
  their geometry is valid, materializes a portable SVG beside each blob.
  `assets/vectors.json` maps a blob ID to its lossless gzip-compressed path and
  optional `svgPath`; `document.agent.json` carries the same fields in
  `vectorRef`. SVG paths use `currentColor`, so consumers can style inline SVG
  consistently; malformed vector blobs remain available only as `.bin.gz`.
- Core consumers can use `composeVectorGroupSvg()` to compose a maximal
  vector-only subtree into one SVG. It applies `frameMaskDisabled: false` as
  SVG clip paths and Figma `mask: true` layers as masks for their following
  siblings. Raster fills, strokes, blend modes, effects, gradients, and text
  make a group unavailable rather than producing a partial SVG.
- `frames/*/context.md` is a deterministic, compact summary for every canvas
  and top-level frame. Nested frames remain fully addressable with `pack` and
  are intentionally not duplicated as thousands of tiny files.

## Supported input and compatibility policy

An accepted archive must be a valid ZIP containing `canvas.fig`. The first
decoder supports a `canvas.fig` beginning with `fig-kiwi`; it reads the embedded
Kiwi schema, decompresses the document chunks, and normalizes the decoded tree.

Other canvas payloads are not treated as corrupt by default. They receive the
structured `UNSUPPORTED_FIG_VARIANT` result so a new adapter can be added with
real evidence. The output contract has its own version independent of the
decoder version, allowing parser internals to change without silently breaking
agent integrations.

## Safety and privacy

- Extraction is local-only. The tool does not authenticate with, contact, or
  upload anything to Figma or another service.
- ZIP paths are treated as untrusted. Traversal entries, duplicate critical
  entries, malformed metadata, and configurable resource-limit violations fail
  safely.
- Output is written into a temporary sibling directory and renamed only after a
  complete successful extraction, preventing half-written agent bundles.
- The original `.fig` is read-only. Existing output directories are refused
  unless the caller explicitly requests replacement.
- Real customer or proprietary `.fig` files and generated bundles are never
  committed as fixtures.

## Architecture

The repository is a TypeScript/Node.js workspace with these boundaries:

- `packages/core` owns archive reading, Kiwi decoding, normalizing, token
  extraction, and atomic bundle writing.
- `packages/cli` owns command parsing, human-readable diagnostics, and exit
  codes.
- `packages/mcp-server` serves existing bundles over stdio and never reparses
  Figma files or contacts Figma.
- `examples/` contains schemas and synthetic examples only.

The Kiwi dependency is isolated behind a `KiwiDecoder` adapter. This keeps the
undocumented binary format separate from the long-lived public JSON contract.

## Errors

Failures are structured in `manifest.json`, printed concisely by the CLI, and
use nonzero exit codes. Initial error codes are:

- `INVALID_FIG_ARCHIVE`
- `MISSING_CANVAS`
- `UNSUPPORTED_FIG_VARIANT`
- `CORRUPT_KIWI_CHUNK`
- `RESOURCE_LIMIT_EXCEEDED`
- `OUTPUT_EXISTS`
- `NODE_NOT_FOUND`
- `NODE_REFERENCE_FILE_MISMATCH`
- `INVALID_REFERENCE_IMAGE`
- `REFERENCE_IMAGE_DIMENSION_MISMATCH`
- `REFERENCE_NOT_FOUND`

## Tests and fixtures

The test suite has three layers:

1. Unit tests for archive/variant detection, safe paths, image signatures, and
   token normalization.
2. Committed synthetic fixture archives for successful, malformed, and
   unsupported cases, including snapshot tests for the stable agent document.
3. A local-only acceptance test enabled with `FIGCTX_ACCEPTANCE_FIG`. It checks
   successful decode of a real export without copying, snapshotting, printing,
   or committing the design or its output.

## Non-goals for the first release

- Screenshot-perfect rendering
- A Figma API client, Figma MCP client, or browser automation
- Editing or writing `.fig` files
- A hosted service

## References and attribution

The implementation follows the local-export flow described by
[Figma Help](https://help.figma.com/hc/en-us/articles/360041003114-Import-files-to-the-file-browser).
It treats the format as unstable, consistent with
[Evan Wallace's parser note](https://madebyevan.com/figma/fig-file-parser/).
The Kiwi binary runtime is MIT-licensed and provides the embedded-schema
decoding model used by this project; see [evanw/kiwi](https://github.com/evanw/kiwi).
The project also acknowledges [kreako/fig2json](https://github.com/kreako/fig2json)
as an open-source precedent for local, LLM-oriented `.fig` conversion.

## License

MIT. See [LICENSE](LICENSE).
