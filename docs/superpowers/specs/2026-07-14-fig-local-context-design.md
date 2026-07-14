# fig-local-context design

**Date:** 2026-07-14
**Status:** approved design; implementation pending written-spec review

## 1. Problem and scope

`fig-local-context` is a local-only TypeScript/Node.js tool for turning Figma
`.fig` exports into a stable context bundle for coding agents. It consumes files
that the user legitimately exported or owns. It must not call Figma APIs, Figma
MCP servers, browser automation, or any remote service.

The supported input path is Figma's ordinary local-export container: a ZIP
archive that contains `meta.json`, `canvas.fig`, `thumbnail.png`, and optional
extensionless `images/` files. The real local acceptance file used during design
is a ZIP archive whose `canvas.fig` starts with `fig-kiwi`, confirming that Kiwi
binary decoding is required for the first milestone.

The project optimizes for context extraction, not screenshot-perfect rendering.
It is a separate public repository with no proprietary design file or generated
bundle committed to Git.

## 2. Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Runtime | TypeScript on supported Node.js LTS releases | Simple CLI distribution and future agent integration. |
| Archive strategy | Safe ZIP reader with entry allowlisting and resource limits | `.fig` inputs are local but still untrusted archives. |
| Canvas strategy | Decode `fig-kiwi` using a pinned TypeScript Kiwi adapter | The real sample requires Kiwi; the adapter preserves a pure Node/TypeScript core. |
| Decoder dependency | Pin and wrap `kiwi-schema` behind `KiwiDecoder` | Reuse a focused existing implementation while containing compatibility risk. |
| Public contract | Versioned normalized JSON plus deterministic Markdown summaries | Agents need stability even when Figma's internal binary format changes. |
| Output writes | Temporary sibling directory followed by rename | No agent should observe a partial bundle. |
| MCP | Deferred | The CLI and bundle contract are the first product; MCP only reads those bundles later. |
| License | MIT | Compatible with the MIT Kiwi runtime and common CLI reuse. |

## 3. Repository layout

```text
fig-local-context/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── archive/
│   │       ├── decoder/
│   │       ├── normalize/
│   │       ├── tokens/
│   │       └── bundle/
│   ├── cli/
│   └── mcp-server/                # Reserved; not implemented in milestone one
├── examples/                       # Synthetic data and expected output only
├── docs/superpowers/specs/
├── README.md
└── LICENSE
```

`packages/core` never parses CLI arguments or prints to the terminal.
`packages/cli` converts core result types into user-facing output and exit codes.
This prevents future MCP integration from depending on shell behavior.

## 4. Extraction data flow

1. Read the source path without modifying it; calculate a source SHA-256 while
   reading.
2. Confirm the outer ZIP signature and enumerate entries safely. Reject duplicate
   critical entries, paths outside the expected layout, and resource-limit
   violations.
3. Read `meta.json`, `canvas.fig`, `thumbnail.png`, and `images/` streams.
4. Detect the canvas variant. Dispatch `fig-kiwi` to the Kiwi adapter; report
   other variants as `UNSUPPORTED_FIG_VARIANT`.
5. The adapter validates the header, extracts/decompresses schema and data
   chunks, decodes the embedded schema, and returns a decoded document tree.
6. Build the node hierarchy from document changes. Keep raw decoded content for
   diagnostics but separate binary blobs from JSON.
7. Normalize nodes into the public agent model. Preserve geometry, transforms,
   parent/child order, visibility, layout/constraints, paints, typography,
   effects, text, image references, and vector references.
8. Stream image entries to `assets/images/`, selecting file extensions from
   payload signatures (PNG, JPEG, GIF, WebP, SVG-like data) rather than archive
   names.
9. Convert supported decoded vector command data to SVG. Preserve unsupported
   references in the agent document and add a manifest warning.
10. Deduplicate color, typography, and effect token records, retaining source
    node IDs. Create deterministic frame summaries from the normalized tree.
11. Validate all generated JSON against the internal contract, write the bundle
    to a temporary sibling directory, then rename it into place atomically.

## 5. Stable output contract

An extraction produces this directory:

```text
<out>/
├── manifest.json
├── document.raw.json
├── document.agent.json
├── tokens/colors.json
├── tokens/typography.json
├── tokens/effects.json
├── assets/images/<hash>.<inferred-extension>
├── assets/vectors/<node-id>.svg      # only when representable
└── frames/<node-id>/context.md
```

### `manifest.json`

Records `contractVersion`, `parserVersion`, source filename and SHA-256, detected
archive/canvas variants, status (`success` or `failed`), warnings, counts, and a
structured failure object when applicable. The source path itself is not written,
avoiding accidental disclosure of local machine layout.

### `document.raw.json`

Contains the decoded Kiwi document and parser metadata needed to reproduce or
diagnose normalization. It must not inline megabytes of image/vector blob data.

### `document.agent.json`

Contains a root `document` and recursively ordered `children`. Each normalized
node has a stable input-derived `id`, name, type, `parentId`, `zIndex`, absolute
bounds, transform, visibility, opacity, constraints, layout, paints, strokes,
text, typography, effects, and references to extracted assets or vectors when
present. Optional values are absent rather than fabricated.

### Token documents

Each token document holds a `contractVersion` and deterministic records sorted
by canonical value. A record identifies its canonical value and all source node
IDs. Colors retain fill/stroke/gradient and opacity context; typography retains
family, size, weight, line height, letter spacing, and text case; effects retain
shadows, blurs, and borders.

### Frame summaries

`context.md` is deterministic Markdown, generated only from normalized fields.
It includes frame identity, dimensions, layout summary, descendant text, token
references, and relative asset references. Untrusted layer names and text are
rendered as literal content, not executable instructions.

## 6. CLI behavior

```text
figctx extract <file.fig> --out <directory>
figctx inspect <bundle-directory> --node <node-id>
figctx pack <bundle-directory> --node <node-id> --format codex
```

`extract` creates a bundle and refuses a nonempty output path unless explicitly
overridden. `inspect` reads `document.agent.json` and prints the selected node's
context. `pack` produces the compact deterministic object/Markdown payload for
an agent. Neither command reopens the source `.fig`.

The CLI maps core failures to nonzero exits and short diagnostics. Machine-
readable detail always remains in the manifest.

## 7. Error model

| Code | Meaning |
| --- | --- |
| `INVALID_FIG_ARCHIVE` | Input is not a supported ZIP archive or violates archive safety rules. |
| `MISSING_CANVAS` | Archive lacks `canvas.fig`. |
| `UNSUPPORTED_FIG_VARIANT` | Canvas signature is valid enough to identify but no decoder adapter supports it. |
| `CORRUPT_KIWI_CHUNK` | A `fig-kiwi` header, chunk boundary, compression stream, schema, or message cannot be decoded. |
| `RESOURCE_LIMIT_EXCEEDED` | Configured compressed, expanded, entry-count, or JSON-size limit was exceeded. |
| `OUTPUT_EXISTS` | Output location is already populated and replacement was not requested. |

Failures may still write an atomic diagnostic-only bundle when an output path was
requested and doing so is safe. They never present partial decoded output as a
successful agent bundle.

## 8. Security and privacy

- No network module is needed at runtime; tests must not use networked services.
- ZIP entry paths are normalized and allowlisted before writing.
- Image signature sniffing is bounded; unknown assets are retained only when
  safely extractable and declared in the manifest.
- Decoder input, recursion, expansion, and output sizes have conservative
  configurable limits.
- User text is data, not instructions. Agent summaries label it as source text
  and escape Markdown where needed.
- Real design files and their extracted output are ignored by Git. A test uses a
  supplied local path through `FIGCTX_ACCEPTANCE_FIG` and asserts structural
  properties only.

## 9. Test strategy

### Unit tests

- ZIP and canvas signature detection
- Duplicate/traversal/resource-limit archive rejection
- PNG/JPEG/GIF/WebP/SVG-like image signature detection
- Color, typography, and effect normalization
- Deterministic token deduplication and frame summaries
- Stable agent-document snapshots from decoded synthetic input

### Synthetic fixtures

Committed fixtures include a minimal text-and-rectangle archive, embedded image
assets, nested auto-layout/frame nodes, malformed archive cases, and unsupported
canvas signatures. Fixtures are generated from transparent test data and contain
no proprietary Figma export.

### Local acceptance test

When `FIGCTX_ACCEPTANCE_FIG` is set, the test extracts that local file to a
temporary directory and checks that a Kiwi tree, text, geometry, color,
typography, and asset paths are present. It does not snapshot, log, retain, or
commit the file or resulting bundle.

## 10. Acceptance criteria

The first release is accepted when a supported local `fig-kiwi` export produces
a valid bundle from which `figctx inspect --node <node-id>` retrieves text,
dimensions, colors, typography, layout data, and relative asset paths without
any network activity. The Logika export is the local acceptance source for this
milestone; it is not a repository fixture.

## 11. Explicit non-goals and follow-up

Milestone one does not promise screenshot-perfect rendering, `.fig` writing,
live Figma access, browser automation, or an MCP server. The MCP server begins
only after the CLI output contract has fixture and real-file coverage. It will
expose `list_frames`, `get_node_context`, `get_asset`, `get_style_tokens`, and
`get_frame_bundle` over pre-extracted local bundles.
