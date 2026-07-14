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

The public contract and decoder design are approved. The first implementation
targets normal Figma **Save local copy** exports: ZIP archives containing
`meta.json`, `canvas.fig`, a thumbnail, and optional `images/` entries. The
`canvas.fig` payload is decoded locally from Figma's Kiwi binary format.

The initial compatibility target is the `fig-kiwi` canvas signature. The format
is an undocumented Figma implementation detail, so compatibility is deliberately
versioned and unsupported variants fail explicitly instead of being guessed.

## What it will do

```sh
figctx extract design.fig --out .figctx/design
figctx inspect .figctx/design --node <node-id>
figctx pack .figctx/design --node <node-id> --format codex
```

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
│   └── effects.json
├── assets/images/
├── assets/vectors/
└── frames/<node-id>/context.md
```

### Bundle files

- `manifest.json` records the source file name and SHA-256, parser and contract
  versions, detected variants, extraction status, and warnings.
- `document.raw.json` is the decoded Kiwi document for diagnostics. Large binary
  blobs remain files or references, not base64 JSON payloads.
- `document.agent.json` is the stable normalized layer tree. Nodes retain IDs,
  names, type, parent/child ordering, absolute bounds, transforms, visibility,
  opacity, constraints, layout details, paints, effects, text, and asset/vector
  references.
- `tokens/` contains deduplicated colors, typography, and effects, each with
  the source node IDs that produced it.
- `assets/images/` contains extracted raster assets with extensions inferred
  from their real byte signatures, not from Figma's extensionless filenames.
- `assets/vectors/` contains SVG when a decoded vector path can be represented
  safely. Unsupported vector payloads are kept as references with a warning.
- `frames/*/context.md` is a deterministic, compact per-frame summary for
  prompt-based use. It is generated locally, never by a remote model.

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
- `packages/mcp-server` is intentionally deferred until the CLI bundle contract
  is validated. It will serve existing bundles instead of reparsing Figma files.
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
- An MCP server before the CLI bundle contract is stable

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
