# Ready Vector Backgrounds Design

## Goal

Export Figma vector backgrounds as ready-to-use, single image assets so a
consumer can place a background without reconstructing Kiwi vector fragments.
Use the extracted assets to implement the approved six-card Logika section.

## Scope

- Add a deterministic vector-rendering export path to `fig-local-context`.
- Keep original raster images byte-for-byte unchanged and retain their existing
  references.
- Surface each rendered background in the bundle index and the normalized node
  document, so CLI packing and the MCP server expose the same asset path.
- Extract Figma node `606:19569` from the local Logika export and use the
  resulting assets for the six cards in Logika's media-center source page.

## Architecture

The core package will render a referenced Kiwi vector network into a single
PNG asset during extraction. `writeBundle` will write the rendered asset next
to extracted raster images and record it in the asset metadata. Normalization
will attach the ready asset reference to the owning node, while preserving the
lossless vector-network reference for diagnostics and backward compatibility.

The Logika page will use only exported, ready image paths for the card artwork.
Its source HTML and SCSS are the source of truth; the generated `build/` page
is validated through the repository's existing build pipeline.

## Data Flow

1. Decode the local `.fig` archive and identify vector-network blobs referenced
   by nodes in the requested design subtree.
2. Render each referenced vector into one PNG asset with deterministic naming.
3. Write the PNG plus an index entry; leave native PNG/JPEG/WebP/GIF assets
   untouched.
4. Add the ready image path to the normalized node that owns the vector.
5. Pack node `606:19569`, map its six card images to their matching cards, and
   add the section to `source/media-center.html` with dedicated SCSS.

## Compatibility and Errors

- Existing `vectorRef` values and compressed vector blobs remain in place.
- A vector that cannot be rendered remains extractable: its lossless blob is
  retained and extraction records a structured warning rather than emitting a
  misleading broken SVG.
- No network calls, Figma API calls, or browser automation are introduced.

## Verification

- Unit tests first prove that a vector background becomes one indexed ready
  image and that raster image bytes and paths remain unchanged.
- The workspace test suite and typecheck pass.
- The actual Logika `.fig` extraction confirms the selected node has six
  associated card assets, then the Logika build and a browser screenshot verify
  each asset appears on the intended card.
