# Ready Vector Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export vector-only Figma subtrees as ready PNG assets and use the extracted Logika card illustrations in `media-center.html`.

**Architecture:** Keep the existing lossless `vectorRef` path intact, and add a separate `readyAssetRefs` contract for rendered PNGs. The renderer targets maximal vector-only subtrees, so a card illustration like `Layer_1` becomes one image instead of hundreds of broken vector fragments. Logika consumes those ready PNGs from `source/img/media-center/why-logika/` while text and card layout remain normal HTML/SCSS.

**Tech Stack:** TypeScript, Node.js 20+, pnpm 10.33.2, Vitest, Kiwi decoded `.fig` data, `@resvg/resvg-js` for deterministic SVG-to-PNG rasterization, Logika gulp/static HTML/SCSS build.

## Global Constraints

- Add a deterministic vector-rendering export path to `fig-local-context`.
- Keep original raster images byte-for-byte unchanged and retain their existing references.
- Surface each rendered background in the bundle index and the normalized node document, so CLI packing and the MCP server expose the same asset path.
- Extract Figma node `606:19569` from `/home/sbaikov/Downloads/Logika School UX_UI Design (2) (Copy).fig`.
- Use canonical node reference `606-19569` or `606:19569` for local packs; the full Figma URL is expected to fail when the local export has a synthetic `originFileKey`.
- Use the six vector-only card illustration roots under node `606:19569`; the current pack has 953 nodes, 13 text nodes, 0 raster assets, and hundreds of vector blobs.
- Do not introduce Figma API calls, Figma MCP calls, or browser automation into the extractor.
- Preserve existing CLI/MCP consumers that only know about `assetRefs` and `vectorRef`.
- Keep generated bundles and real `.fig` contents out of git.
- In Logika, edit source files first; generated `build/` output is validation output from gulp.

---

## File Structure

- Modify `packages/core/package.json`: add `@resvg/resvg-js` dependency.
- Create `packages/core/src/render/types.ts`: shared rendered asset and warning types.
- Create `packages/core/src/render/targets.ts`: finds maximal vector-only render targets.
- Create `packages/core/src/render/vector-network.ts`: converts supported Figma vector-network blob bytes to SVG path data.
- Create `packages/core/src/render/svg-scene.ts`: converts a normalized vector-only subtree to a self-contained SVG.
- Create `packages/core/src/render/render-ready-assets.ts`: renders targets to PNG buffers and produces bundle metadata.
- Modify `packages/core/src/normalize/document.ts`: add `readyAssetRefs` to `AgentNode` without changing existing `assetRefs`/`vectorRef`.
- Modify `packages/core/src/context/node-context.ts`: include deduplicated ready assets in pack/MCP contexts.
- Modify `packages/core/src/bundle/write-bundle.ts`: write `assets/ready/*.png` and `assets/ready.json`.
- Modify `packages/core/src/extract.ts`: build render targets after normalization, render ready assets, re-normalize with ready asset paths, and pass assets/warnings to the bundle writer.
- Modify `packages/core/src/index.ts`: export new ready asset types.
- Modify `packages/cli/src/main.ts`: `pack` already serializes `buildNodeContext`; no new command output code should be needed after the context type is updated.
- Modify `packages/mcp-server/src/main.ts`: `get_frame_bundle` inherits ready assets through `buildNodeContext`; no new MCP tool is added in this implementation.
- Modify `README.md`: document `assets/ready/`, `assets/ready.json`, and the distinction between lossless vectors and ready PNGs.
- Add/modify tests in `packages/core/test/normalize.test.ts`, `packages/core/test/bundle.test.ts`, and `packages/core/test/render-ready-assets.test.ts`.
- Modify Logika `/home/sbaikov/Desktop/Projects/logika/source/media-center.html`.
- Modify Logika `/home/sbaikov/Desktop/Projects/logika/source/scss/blocks/sections/media-section.scss`.
- Add extracted assets under `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/`.

### Data Contracts

```ts
export interface ReadyAssetReference {
  id: string;
  sourceNodeId: string;
  path: string;
  kind: 'rendered-vector-subtree';
  format: 'png';
  width: number;
  height: number;
  scale: number;
  sha256: string;
}
```

```ts
export interface BundleReadyAsset {
  id: string;
  sourceNodeId: string;
  bytes: Uint8Array;
  format: 'png';
  width: number;
  height: number;
  scale: number;
  sha256: string;
}
```

```ts
export interface ReadyAssetWarning {
  code: 'UNSUPPORTED_VECTOR_NETWORK' | 'EMPTY_VECTOR_SUBTREE' | 'RENDER_READY_ASSET_FAILED';
  nodeId: string;
  message: string;
}
```

### Render Target Rule

A node is a ready-asset target when:

```ts
node.type !== 'TEXT'
&& subtreeHasVisibleVector(node)
&& !subtreeHasText(node)
&& !parentSubtreeIsVectorOnly(node)
```

This makes the six Logika illustration `Layer_1` groups render once each, while nested vector fragments remain internal implementation detail.

---

### Task 1: Add Ready Asset Contract To Normalization And Context

**Files:**
- Modify: `packages/core/src/normalize/document.ts`
- Modify: `packages/core/src/context/node-context.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/normalize.test.ts`

**Interfaces:**
- Consumes: existing `normalizeDocument(changes, options)`.
- Produces: `ReadyAssetReference`, `AgentNode.readyAssetRefs`, `NormalizeOptions.readyAssetPaths`, `NodeContext.readyAssets`.

- [ ] **Step 1: Write the failing normalization/context tests**

Add to `packages/core/test/normalize.test.ts`:

```ts
test('links a rendered vector subtree to its ready PNG asset path', () => {
  const normalized = normalizeDocument([
    { guid: { sessionID: 6, localID: 1 }, type: 'FRAME', name: 'Layer_1' }
  ], {
    readyAssetPaths: {
      '6:1': {
        id: 'rendered-vector-subtree-6_1',
        sourceNodeId: '6:1',
        path: 'assets/ready/rendered-vector-subtree-6_1.png',
        kind: 'rendered-vector-subtree',
        format: 'png',
        width: 253,
        height: 240,
        scale: 2,
        sha256: '00'.repeat(32)
      }
    }
  });

  expect(normalized.nodesById['6:1']!.readyAssetRefs).toEqual([
    {
      id: 'rendered-vector-subtree-6_1',
      sourceNodeId: '6:1',
      path: 'assets/ready/rendered-vector-subtree-6_1.png',
      kind: 'rendered-vector-subtree',
      format: 'png',
      width: 253,
      height: 240,
      scale: 2,
      sha256: '00'.repeat(32)
    }
  ]);
});

test('collects descendant ready assets for a frame context', () => {
  const normalized = normalizeDocument([
    { guid: { sessionID: 7, localID: 1 }, type: 'FRAME', name: 'Card' },
    { guid: { sessionID: 7, localID: 2 }, type: 'FRAME', name: 'Layer_1', parentIndex: 0 }
  ], {
    readyAssetPaths: {
      '7:2': {
        id: 'rendered-vector-subtree-7_2',
        sourceNodeId: '7:2',
        path: 'assets/ready/rendered-vector-subtree-7_2.png',
        kind: 'rendered-vector-subtree',
        format: 'png',
        width: 120,
        height: 80,
        scale: 2,
        sha256: '11'.repeat(32)
      }
    }
  });

  const context = buildNodeContext(normalized, normalized.nodesById['7:1']!);
  expect(context.readyAssets).toEqual([
    expect.objectContaining({
      id: 'rendered-vector-subtree-7_2',
      sourceNodeId: '7:2',
      path: 'assets/ready/rendered-vector-subtree-7_2.png'
    })
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @figctx/core test -- normalize.test.ts
```

Expected: FAIL because `readyAssetPaths`, `readyAssetRefs`, and `context.readyAssets` do not exist.

- [ ] **Step 3: Implement minimal contract**

Update `packages/core/src/normalize/document.ts`:

```ts
export interface AgentNode {
  id: string;
  name: string;
  type: string;
  parentId?: string;
  childIds: string[];
  zIndex: number;
  text?: string;
  bounds?: unknown;
  transform?: unknown;
  constraints?: { horizontal?: unknown; vertical?: unknown };
  layout?: Record<string, unknown>;
  fills?: unknown;
  strokes?: unknown;
  effects?: unknown;
  typography?: Record<string, unknown>;
  textLayout?: Record<string, unknown>;
  visible?: boolean;
  opacity?: number;
  blendMode?: unknown;
  assetRefs: AssetReference[];
  readyAssetRefs: ReadyAssetReference[];
  vectorRef?: VectorReference;
}

export interface ReadyAssetReference {
  id: string;
  sourceNodeId: string;
  path: string;
  kind: 'rendered-vector-subtree';
  format: 'png';
  width: number;
  height: number;
  scale: number;
  sha256: string;
}

export interface NormalizeOptions {
  originFileKey?: string;
  assetPaths?: Readonly<Record<string, string>>;
  vectorPaths?: Readonly<Record<number, string>>;
  readyAssetPaths?: Readonly<Record<string, ReadyAssetReference>>;
}
```

Pass the new option through `normalizeDocument()` into `normalizeNode()`, and set:

```ts
readyAssetRefs: readyAssetReference(id, readyAssetPaths),
```

Add helper:

```ts
function readyAssetReference(
  nodeId: string,
  readyAssetPaths: Readonly<Record<string, ReadyAssetReference>> | undefined
): ReadyAssetReference[] {
  const reference = readyAssetPaths?.[nodeId];
  return reference ? [reference] : [];
}
```

Update `packages/core/src/context/node-context.ts`:

```ts
import type { AgentDocument, AgentNode, AssetReference, ReadyAssetReference, VectorReference } from '../normalize/document.js';

export interface NodeContext {
  node: AgentNode;
  ancestors: Array<Pick<AgentNode, 'id' | 'name' | 'type'>>;
  nodes: AgentNode[];
  text: Array<Pick<AgentNode, 'id' | 'name' | 'text' | 'typography'>>;
  assets: AssetReference[];
  readyAssets: ReadyAssetReference[];
  vectors: VectorReference[];
  nodeIds: string[];
}
```

Inside `buildNodeContext()`:

```ts
const readyAssets = unique(nodes.flatMap((item) => item.readyAssetRefs), (item) => item.path);
return { node, ancestors, nodes, text, assets, readyAssets, vectors, nodeIds: nodes.map((item) => item.id) };
```

Update `packages/core/src/index.ts` export:

```ts
export {
  normalizeDocument,
  resolveNodeReference,
  canonicalNodeId,
  hashToHex,
  type AgentDocument,
  type AgentNode,
  type AssetReference,
  type ReadyAssetReference
} from './normalize/document.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @figctx/core test -- normalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/normalize/document.ts packages/core/src/context/node-context.ts packages/core/src/index.ts packages/core/test/normalize.test.ts
git commit -m "feat: expose ready vector asset refs"
```

---

### Task 2: Write Ready PNG Assets Into Bundles

**Files:**
- Modify: `packages/core/src/bundle/write-bundle.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/bundle.test.ts`

**Interfaces:**
- Consumes: `BundleReadyAsset[]`.
- Produces: `assets/ready/<id>.png`, `assets/ready.json`, and frame summaries that list both raster and ready assets.

- [ ] **Step 1: Write the failing bundle test**

Update the existing `writeBundle()` call in `packages/core/test/bundle.test.ts` to include:

```ts
readyAssets: [{
  id: 'rendered-vector-subtree-6_1',
  sourceNodeId: '6:1',
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  format: 'png',
  width: 253,
  height: 240,
  scale: 2,
  sha256: '22'.repeat(32)
}]
```

Add assertions:

```ts
await expect(readFile(join(outDir, 'assets/ready/rendered-vector-subtree-6_1.png'))).resolves.toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
expect(JSON.parse(await readFile(join(outDir, 'assets/ready.json'), 'utf8'))).toMatchObject({
  contractVersion: '1',
  readyAssets: [{
    id: 'rendered-vector-subtree-6_1',
    sourceNodeId: '6:1',
    path: 'assets/ready/rendered-vector-subtree-6_1.png',
    format: 'png',
    width: 253,
    height: 240,
    scale: 2,
    sha256: '22'.repeat(32)
  }]
});
```

Update the second `writeBundle()` call to pass `readyAssets: []`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @figctx/core test -- bundle.test.ts
```

Expected: FAIL because `readyAssets` is not part of `BundleInput` and `assets/ready.json` is not written.

- [ ] **Step 3: Implement bundle writing**

Add to `packages/core/src/bundle/write-bundle.ts`:

```ts
export interface BundleReadyAsset {
  id: string;
  sourceNodeId: string;
  bytes: Uint8Array;
  format: 'png';
  width: number;
  height: number;
  scale: number;
  sha256: string;
}

export interface BundleInput {
  outDir: string;
  manifest: Record<string, unknown>;
  raw: unknown;
  agent: AgentDocument;
  images: readonly BundleImage[];
  vectors: readonly BundleVector[];
  readyAssets: readonly BundleReadyAsset[];
  thumbnail?: Uint8Array;
  tokens: ExtractedTokens;
}
```

Create the directory:

```ts
await mkdir(join(temporary, 'assets/ready'), { recursive: true });
```

Write the ready asset index after `assets/images.json`:

```ts
const readyAssetIndex: Array<Omit<BundleReadyAsset, 'bytes'> & { path: string }> = [];
for (const asset of input.readyAssets) {
  const path = `assets/ready/${safeName(asset.id)}.png`;
  await writeFile(join(temporary, path), asset.bytes);
  readyAssetIndex.push({
    id: asset.id,
    sourceNodeId: asset.sourceNodeId,
    path,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    scale: asset.scale,
    sha256: asset.sha256
  });
}
await writeJson(join(temporary, 'assets/ready.json'), { contractVersion: '1', readyAssets: readyAssetIndex });
```

Include ready assets in `context.md` summaries:

```ts
const readyAssets = node.readyAssetRefs.map((asset) => `- ready asset: \`${asset.path}\` (${asset.sourceNodeId})`).join('\n');
await writeFile(join(directory, 'context.md'), `# ${node.name}\n\n- id: \`${node.id}\`\n- type: ${node.type}\n- children: ${node.childIds.length}${assets ? `\n${assets}` : ''}${readyAssets ? `\n${readyAssets}` : ''}\n`);
```

Update `packages/core/src/index.ts`:

```ts
export { writeBundle, type BundleInput, type BundleVector, type BundleReadyAsset } from './bundle/write-bundle.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @figctx/core test -- bundle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bundle/write-bundle.ts packages/core/src/index.ts packages/core/test/bundle.test.ts
git commit -m "feat: write ready vector assets"
```

---

### Task 3: Render Maximal Vector-Only Subtrees

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/render/types.ts`
- Create: `packages/core/src/render/targets.ts`
- Create: `packages/core/src/render/vector-network.ts`
- Create: `packages/core/src/render/svg-scene.ts`
- Create: `packages/core/src/render/render-ready-assets.ts`
- Test: `packages/core/test/render-ready-assets.test.ts`

**Interfaces:**
- Consumes: `AgentDocument`, decoded raw changes, extracted `BundleVector[]`.
- Produces: `{ readyAssets: BundleReadyAsset[]; readyAssetRefs: Record<string, ReadyAssetReference>; warnings: ReadyAssetWarning[] }`.

- [ ] **Step 1: Add dependency**

Run:

```bash
pnpm --filter @figctx/core add @resvg/resvg-js
```

Expected: `packages/core/package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Write the failing render-target test**

Create `packages/core/test/render-ready-assets.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { normalizeDocument } from '../src/normalize/document.js';
import { findReadyAssetTargets } from '../src/render/targets.js';

describe('ready vector asset rendering', () => {
  test('selects maximal vector-only subtrees without selecting nested fragments', () => {
    const document = normalizeDocument([
      { guid: { sessionID: 8, localID: 1 }, type: 'FRAME', name: 'Card' },
      { guid: { sessionID: 8, localID: 2 }, type: 'TEXT', name: 'Title', parentIndex: 0, textData: { characters: 'Title' } },
      { guid: { sessionID: 8, localID: 3 }, type: 'FRAME', name: 'Layer_1', parentIndex: 0 },
      { guid: { sessionID: 8, localID: 4 }, type: 'FRAME', name: 'Group', parentIndex: 2 },
      { guid: { sessionID: 8, localID: 5 }, type: 'VECTOR', name: 'Vector', parentIndex: 3, vectorData: { vectorNetworkBlob: 7 } }
    ], { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' } });

    expect(findReadyAssetTargets(document).map((node) => node.id)).toEqual(['8:3']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm --filter @figctx/core test -- render-ready-assets.test.ts
```

Expected: FAIL because `findReadyAssetTargets()` does not exist.

- [ ] **Step 4: Implement target selection**

Create `packages/core/src/render/types.ts`:

```ts
import type { BundleReadyAsset } from '../bundle/write-bundle.js';
import type { ReadyAssetReference } from '../normalize/document.js';

export interface ReadyAssetWarning {
  code: 'UNSUPPORTED_VECTOR_NETWORK' | 'EMPTY_VECTOR_SUBTREE' | 'RENDER_READY_ASSET_FAILED';
  nodeId: string;
  message: string;
}

export interface ReadyAssetRenderResult {
  readyAssets: BundleReadyAsset[];
  readyAssetRefs: Record<string, ReadyAssetReference>;
  warnings: ReadyAssetWarning[];
}
```

Create `packages/core/src/render/targets.ts`:

```ts
import type { AgentDocument, AgentNode } from '../normalize/document.js';

export function findReadyAssetTargets(document: AgentDocument): AgentNode[] {
  return Object.values(document.nodesById)
    .filter((node) => node.type !== 'TEXT')
    .filter((node) => subtreeHasVisibleVector(document, node))
    .filter((node) => !subtreeHasText(document, node))
    .filter((node) => !vectorOnlyAncestor(document, node))
    .sort((a, b) => a.zIndex - b.zIndex);
}

function vectorOnlyAncestor(document: AgentDocument, node: AgentNode): boolean {
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  return Boolean(parent && parent.type !== 'TEXT' && subtreeHasVisibleVector(document, parent) && !subtreeHasText(document, parent));
}

function subtreeHasVisibleVector(document: AgentDocument, node: AgentNode): boolean {
  if (node.vectorRef && node.visible !== false) return true;
  return node.childIds.some((id) => {
    const child = document.nodesById[id];
    return Boolean(child && subtreeHasVisibleVector(document, child));
  });
}

function subtreeHasText(document: AgentDocument, node: AgentNode): boolean {
  if (node.text !== undefined) return true;
  return node.childIds.some((id) => {
    const child = document.nodesById[id];
    return Boolean(child && subtreeHasText(document, child));
  });
}
```

- [ ] **Step 5: Run render-target test to verify it passes**

Run:

```bash
pnpm --filter @figctx/core test -- render-ready-assets.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing render output test**

Extend `packages/core/test/render-ready-assets.test.ts`:

```ts
import { renderReadyAssets } from '../src/render/render-ready-assets.js';

test('renders a vector-only subtree into an indexed PNG asset', async () => {
  const changes = [
    { guid: { sessionID: 9, localID: 1 }, type: 'FRAME', name: 'Layer_1', size: { x: 16, y: 16 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } },
    {
      guid: { sessionID: 9, localID: 2 },
      type: 'VECTOR',
      name: 'Vector',
      parentIndex: 0,
      size: { x: 10, y: 10 },
      transform: { m00: 1, m01: 0, m02: 3, m10: 0, m11: 1, m12: 3 },
      fillPaints: [{ type: 'SOLID', color: { r: 0.3764705955982208, g: 0.16862745583057404, b: 0.47843137383461, a: 1 }, opacity: 1, visible: true }],
      vectorData: { vectorNetworkBlob: 7, normalizedSize: { x: 10, y: 10 } }
    }
  ];
  const document = normalizeDocument(changes, { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' } });
  const blob = makeRectVectorNetworkBlob(10, 10);

  const result = await renderReadyAssets({ document, changes, vectors: [{ blobId: 7, bytes: blob }], scale: 2 });

  expect(result.warnings).toEqual([]);
  expect(result.readyAssets).toHaveLength(1);
  expect(result.readyAssets[0]).toMatchObject({
    id: 'rendered-vector-subtree-9_1',
    sourceNodeId: '9:1',
    format: 'png',
    width: 16,
    height: 16,
    scale: 2
  });
  expect(Array.from(result.readyAssets[0]!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(result.readyAssetRefs['9:1']!.path).toBe('assets/ready/rendered-vector-subtree-9_1.png');
});

function makeRectVectorNetworkBlob(width: number, height: number): Uint8Array {
  const buffer = new ArrayBuffer(4 + 4 + 4 + 8 * 4);
  const view = new DataView(buffer);
  view.setUint32(0, 4, true);
  view.setUint32(4, 4, true);
  view.setUint32(8, 1, true);
  const points = [0, 0, width, 0, width, height, 0, height];
  points.forEach((value, index) => view.setFloat32(12 + index * 4, value, true));
  return new Uint8Array(buffer);
}
```

- [ ] **Step 7: Run test to verify it fails**

Run:

```bash
pnpm --filter @figctx/core test -- render-ready-assets.test.ts
```

Expected: FAIL because `renderReadyAssets()` and vector-network parsing do not exist.

- [ ] **Step 8: Implement vector blob to SVG path parser**

Create `packages/core/src/render/vector-network.ts`:

```ts
export interface VectorPath {
  d: string;
}

export function vectorNetworkToPaths(bytes: Uint8Array): VectorPath[] {
  if (bytes.byteLength < 12) throw new Error('Vector network blob is too small.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(0, true);
  const segmentCount = view.getUint32(4, true);
  const regionCount = view.getUint32(8, true);
  const pointOffset = 12;
  const requiredBytes = pointOffset + vertexCount * 2 * 4;
  if (vertexCount < 2 || segmentCount < 1 || regionCount < 1 || requiredBytes > bytes.byteLength) {
    throw new Error('Unsupported vector network blob layout.');
  }

  const points = Array.from({ length: vertexCount }, (_value, index) => {
    const offset = pointOffset + index * 8;
    return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true) };
  });

  const [first, ...rest] = points;
  if (!first) throw new Error('Vector network has no points.');
  const d = [`M ${format(first.x)} ${format(first.y)}`, ...rest.map((point) => `L ${format(point.x)} ${format(point.y)}`), 'Z'].join(' ');
  return [{ d }];
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
```

Note: this first implementation intentionally supports the proven simple polygon subset used by synthetic tests. During Logika acceptance, unsupported blobs produce warnings and remain available as lossless `vectorRef`; any parser expansion must happen in `packages/core/src/render/vector-network.ts` with a focused test in `packages/core/test/render-ready-assets.test.ts` before changing the public contract.

- [ ] **Step 9: Implement SVG subtree renderer**

Create `packages/core/src/render/svg-scene.ts`:

```ts
import type { AgentDocument, AgentNode } from '../normalize/document.js';
import { vectorNetworkToPaths } from './vector-network.js';

export interface SvgSceneInput {
  document: AgentDocument;
  root: AgentNode;
  changesById: ReadonlyMap<string, Record<string, unknown>>;
  vectorBytesByBlobId: ReadonlyMap<number, Uint8Array>;
}

export function renderSubtreeToSvg(input: SvgSceneInput): string {
  const size = rectSize(input.root.bounds);
  const body = input.root.childIds.map((childId) => renderNode(input, childId, 0, 0)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${body}</svg>`;
}

function renderNode(input: SvgSceneInput, nodeId: string, parentX: number, parentY: number): string {
  const node = input.document.nodesById[nodeId];
  if (!node || node.visible === false) return '';
  const change = input.changesById.get(node.id);
  const transform = matrix(change?.transform);
  const x = parentX + transform.x;
  const y = parentY + transform.y;

  if (node.vectorRef) {
    const bytes = input.vectorBytesByBlobId.get(node.vectorRef.blobId);
    if (!bytes) throw new Error(`Missing vector blob ${node.vectorRef.blobId}.`);
    const fill = firstSolidFill(change?.fillPaints);
    return vectorNetworkToPaths(bytes).map((path) => `<path d="${path.d}" transform="translate(${format(x)} ${format(y)})" fill="${fill}" />`).join('');
  }

  if (node.type === 'RECTANGLE' || node.type === 'ROUNDED_RECTANGLE') {
    const size = rectSize(node.bounds);
    const fill = firstSolidFill(change?.fillPaints);
    const radius = numberValue(change?.cornerRadius);
    return `<rect x="${format(x)}" y="${format(y)}" width="${format(size.width)}" height="${format(size.height)}" rx="${format(radius)}" fill="${fill}" />`;
  }

  return node.childIds.map((childId) => renderNode(input, childId, x, y)).join('');
}

function rectSize(value: unknown): { width: number; height: number } {
  const record = objectValue(value);
  const width = typeof record?.x === 'number' ? Math.max(1, Math.ceil(record.x)) : 1;
  const height = typeof record?.y === 'number' ? Math.max(1, Math.ceil(record.y)) : 1;
  return { width, height };
}

function matrix(value: unknown): { x: number; y: number } {
  const record = objectValue(value);
  return { x: typeof record?.m02 === 'number' ? record.m02 : 0, y: typeof record?.m12 === 'number' ? record.m12 : 0 };
}

function firstSolidFill(value: unknown): string {
  if (!Array.isArray(value)) return 'transparent';
  const fill = value.map(objectValue).find((paint) => paint?.type === 'SOLID' && paint.visible !== false);
  const color = objectValue(fill?.color);
  if (!color) return 'transparent';
  const r = Math.round(numberOrZero(color.r) * 255);
  const g = Math.round(numberOrZero(color.g) * 255);
  const b = Math.round(numberOrZero(color.b) * 255);
  const a = fill?.opacity !== undefined ? numberOrZero(fill.opacity) : numberOrZero(color.a ?? 1);
  return `rgba(${r},${g},${b},${a})`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
```

- [ ] **Step 10: Implement PNG rendering coordinator**

Create `packages/core/src/render/render-ready-assets.ts`:

```ts
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import type { BundleReadyAsset, BundleVector } from '../bundle/write-bundle.js';
import type { AgentDocument, ReadyAssetReference } from '../normalize/document.js';
import { findReadyAssetTargets } from './targets.js';
import { renderSubtreeToSvg } from './svg-scene.js';
import type { ReadyAssetRenderResult, ReadyAssetWarning } from './types.js';

export interface RenderReadyAssetsInput {
  document: AgentDocument;
  changes: readonly Record<string, unknown>[];
  vectors: readonly BundleVector[];
  scale?: number;
}

export async function renderReadyAssets(input: RenderReadyAssetsInput): Promise<ReadyAssetRenderResult> {
  const scale = input.scale ?? 2;
  const changesById = new Map(input.changes.map((change, index) => [idFromGuid(change.guid, index), change]));
  const vectorBytesByBlobId = new Map(input.vectors.map((vector) => [vector.blobId, vector.bytes]));
  const readyAssets: BundleReadyAsset[] = [];
  const readyAssetRefs: Record<string, ReadyAssetReference> = {};
  const warnings: ReadyAssetWarning[] = [];

  for (const target of findReadyAssetTargets(input.document)) {
    try {
      const svg = renderSubtreeToSvg({ document: input.document, root: target, changesById, vectorBytesByBlobId });
      const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } }).render().asPng();
      const bytes = new Uint8Array(png);
      const id = `rendered-vector-subtree-${target.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const size = sizeFromBounds(target.bounds);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const reference: ReadyAssetReference = {
        id,
        sourceNodeId: target.id,
        path: `assets/ready/${id}.png`,
        kind: 'rendered-vector-subtree',
        format: 'png',
        width: size.width,
        height: size.height,
        scale,
        sha256
      };
      readyAssets.push({ ...reference, bytes });
      readyAssetRefs[target.id] = reference;
    } catch (error) {
      warnings.push({
        code: 'RENDER_READY_ASSET_FAILED',
        nodeId: target.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { readyAssets, readyAssetRefs, warnings };
}

function idFromGuid(value: unknown, fallback: number): string {
  const guid = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  return typeof guid?.sessionID === 'number' && typeof guid.localID === 'number' ? `${guid.sessionID}:${guid.localID}` : `index:${fallback}`;
}

function sizeFromBounds(value: unknown): { width: number; height: number } {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  return {
    width: typeof record?.x === 'number' ? Math.max(1, Math.ceil(record.x)) : 1,
    height: typeof record?.y === 'number' ? Math.max(1, Math.ceil(record.y)) : 1
  };
}
```

- [ ] **Step 11: Run render tests to verify they pass**

Run:

```bash
pnpm --filter @figctx/core test -- render-ready-assets.test.ts
```

Expected: PASS for target selection and synthetic PNG rendering.

- [ ] **Step 12: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/render packages/core/test/render-ready-assets.test.ts
git commit -m "feat: render vector-only subtrees"
```

---

### Task 4: Wire Ready Rendering Into Extraction

**Files:**
- Modify: `packages/core/src/extract.ts`
- Modify: `packages/core/src/bundle/write-bundle.ts`
- Modify: `README.md`
- Test: existing core tests plus real local acceptance command.

**Interfaces:**
- Consumes: `renderReadyAssets({ document, changes, vectors })`.
- Produces: extraction bundle with `manifest.warnings`, `document.agent.json` ready refs, and `assets/ready.json`.

- [ ] **Step 1: Write failing extraction integration expectation**

Add to `packages/core/test/render-ready-assets.test.ts`:

```ts
test('ready asset refs can be attached by a second normalization pass', async () => {
  const changes = [
    { guid: { sessionID: 10, localID: 1 }, type: 'FRAME', name: 'Layer_1', size: { x: 16, y: 16 } },
    { guid: { sessionID: 10, localID: 2 }, type: 'VECTOR', name: 'Vector', parentIndex: 0, vectorData: { vectorNetworkBlob: 7 }, size: { x: 10, y: 10 }, fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }
  ];
  const firstPass = normalizeDocument(changes, { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' } });
  const rendered = await renderReadyAssets({ document: firstPass, changes, vectors: [{ blobId: 7, bytes: makeRectVectorNetworkBlob(10, 10) }] });
  const secondPass = normalizeDocument(changes, {
    vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' },
    readyAssetPaths: rendered.readyAssetRefs
  });

  expect(secondPass.nodesById['10:1']!.readyAssetRefs).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it passes before extraction wiring**

Run:

```bash
pnpm --filter @figctx/core test -- render-ready-assets.test.ts
```

Expected: PASS. This proves the rendering contract is ready to wire into `extractFig()`.

- [ ] **Step 3: Update extraction flow**

Modify `packages/core/src/extract.ts`:

```ts
import { renderReadyAssets } from './render/render-ready-assets.js';
```

Replace the single normalization/write block with:

```ts
const vectorPaths = Object.fromEntries(vectors.map((vector) => [vector.blobId, `assets/vectors/vector-network-${vector.blobId}.bin.gz`]));
const firstPassAgent = normalizeDocument(decoded.nodeChanges, { originFileKey, assetPaths, vectorPaths });
const rendered = await renderReadyAssets({ document: firstPassAgent, changes: decoded.nodeChanges, vectors });
const agent = normalizeDocument(decoded.nodeChanges, {
  originFileKey,
  assetPaths,
  vectorPaths,
  readyAssetPaths: rendered.readyAssetRefs
});
await writeBundle({
  outDir,
  manifest: {
    contractVersion: '1',
    parserVersion: decoded.decoderVersion,
    status: 'success',
    sourceFilename: basename(sourcePath),
    sourceSha256: archive.sourceSha256,
    ...(originFileKey ? { originFileKey } : {}),
    canvasVariant: archive.canvasVariant,
    nodeCount: decoded.nodeChanges.length,
    readyAssetCount: rendered.readyAssets.length,
    ...(rendered.warnings.length ? { warnings: rendered.warnings } : {}),
    visualBaseline: archive.thumbnail ? 'assets/thumbnail.png' : undefined
  },
  raw: { decoderVersion: decoded.decoderVersion, canvasVersion: decoded.canvasVersion, document: decoded.document },
  agent,
  images: archive.images,
  vectors,
  readyAssets: rendered.readyAssets,
  thumbnail: archive.thumbnail,
  tokens: extractTokens(agent)
});
```

- [ ] **Step 4: Update README contract**

In `README.md`, add `assets/ready/` and `assets/ready.json` to the bundle tree, then add this bullet after `assets/vectors/`:

```md
- `assets/ready/` contains deterministic PNG renders for maximal vector-only
  subtrees. These are convenience assets for implementation work: the original
  vector-network blobs remain available through `assets/vectors/` and
  `vectorRef`, while `document.agent.json` and `pack` expose `readyAssetRefs`
  for nodes whose vector subtree was rendered successfully.
```

Change the non-goal from:

```md
- Screenshot-perfect rendering
```

to:

```md
- General screenshot-perfect rendering; ready vector PNGs are best-effort
  convenience assets and preserve the original `vectorRef` diagnostics.
```

- [ ] **Step 5: Run workspace tests**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Run real Logika extraction acceptance**

Run:

```bash
rm -rf /tmp/figctx-logika-ready
node packages/cli/dist/main.js extract '/home/sbaikov/Downloads/Logika School UX_UI Design (2) (Copy).fig' --out /tmp/figctx-logika-ready
node packages/cli/dist/main.js pack /tmp/figctx-logika-ready --node '606-19569' --format codex > /tmp/figctx-logika-ready-pack.json
node -e "const fs=require('fs'); const pack=JSON.parse(fs.readFileSync('/tmp/figctx-logika-ready-pack.json','utf8')); console.log(JSON.stringify({readyAssets: pack.readyAssets.length, texts: pack.text.map(t=>t.text)}, null, 2)); if (pack.readyAssets.length < 6) process.exit(1);"
```

Expected: prints at least `readyAssets: 6` and all six card titles:

```text
Єдина платформа – єдина якість
Мінімум 5 реальних проєктів за курс
Відкриті уроки для батьків
Онлайн або у вашому місті
Викладачі з профільною освітою
Власна ігрова методика
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/extract.ts README.md packages/core/test/render-ready-assets.test.ts
git commit -m "feat: emit ready vector assets during extraction"
```

---

### Task 5: Map Logika Assets To Six Cards

**Files:**
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/platform.png`
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/projects.png`
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/open-lessons.png`
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/online-city.png`
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/teachers.png`
- Add: `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/game-method.png`
- No test file; verification is command and screenshot based.

**Interfaces:**
- Consumes: `/tmp/figctx-logika-ready-pack.json` and `/tmp/figctx-logika-ready/assets/ready/*.png`.
- Produces: six stable source image files with names matching card order.

- [ ] **Step 1: Extract pack metadata for card mapping**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const pack = JSON.parse(fs.readFileSync('/tmp/figctx-logika-ready-pack.json', 'utf8'));
const byNode = new Map(pack.nodes.map((node) => [node.id, node]));
function ancestors(node) {
  const out = [];
  let current = node;
  while (current && current.parentId) {
    current = byNode.get(current.parentId);
    if (current) out.push(current);
  }
  return out;
}
const rows = pack.readyAssets.map((asset) => {
  const node = byNode.get(asset.sourceNodeId);
  const parentNames = node ? ancestors(node).map((item) => item.name) : [];
  return { sourceNodeId: asset.sourceNodeId, path: asset.path, nodeName: node?.name, parentNames };
});
console.log(JSON.stringify(rows, null, 2));
NODE
```

Expected: six rows can be mapped to these card parent names:

```text
Навчальна платформа 3 в 1 -> platform.png
Мінімум 5 реальних проєктів за курс -> projects.png
Відкриті уроки для батьків -> open-lessons.png
Онлайн або у вашому місті -> online-city.png
Викладачі з профільною освітою -> teachers.png
Власна ігрова методика -> game-method.png
```

- [ ] **Step 2: Copy the six ready PNGs into Logika source**

Run:

```bash
mkdir -p /home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const bundle = '/tmp/figctx-logika-ready';
const logika = '/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika';
const pack = JSON.parse(fs.readFileSync('/tmp/figctx-logika-ready-pack.json', 'utf8'));
const byNode = new Map(pack.nodes.map((node) => [node.id, node]));
const names = [
  ['Навчальна платформа 3 в 1', 'platform.png'],
  ['Мінімум 5 реальних проєктів за курс', 'projects.png'],
  ['Відкриті уроки для батьків', 'open-lessons.png'],
  ['Онлайн або у вашому місті', 'online-city.png'],
  ['Викладачі з профільною освітою', 'teachers.png'],
  ['Власна ігрова методика', 'game-method.png']
];
function ancestors(node) {
  const out = [];
  let current = node;
  while (current && current.parentId) {
    current = byNode.get(current.parentId);
    if (current) out.push(current.name);
  }
  return out;
}
for (const [parentName, filename] of names) {
  const match = pack.readyAssets.find((asset) => {
    const node = byNode.get(asset.sourceNodeId);
    return node && ancestors(node).includes(parentName);
  });
  if (!match) throw new Error(`Missing ready asset for ${parentName}`);
  fs.copyFileSync(path.join(bundle, match.path), path.join(logika, filename));
  console.log(`${parentName} -> ${filename}`);
}
NODE
```

Expected: six PNG files exist in `/home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/`.

- [ ] **Step 3: Verify PNG dimensions**

Run:

```bash
file /home/sbaikov/Desktop/Projects/logika/source/img/media-center/why-logika/*.png
```

Expected: each file is PNG image data with non-zero dimensions. The dimensions should be close to the illustration group bounds from Figma, not tiny fragment sizes.

- [ ] **Step 4: Keep Logika changes uncommitted until HTML/SCSS/build verification is complete**

Run:

```bash
git -C /home/sbaikov/Desktop/Projects/logika status --short source/img/media-center/why-logika
```

Expected: the six source PNG files are listed as untracked or modified, and no commit is made in this step.

---

### Task 6: Add The Why Logika Section To Media Center

**Files:**
- Modify: `/home/sbaikov/Desktop/Projects/logika/source/media-center.html`
- Modify: `/home/sbaikov/Desktop/Projects/logika/source/scss/blocks/sections/media-section.scss`
- Add: assets from Task 5.

**Interfaces:**
- Consumes: six image paths under `img/media-center/why-logika/`.
- Produces: a responsive section with semantic text and correct images in the six cards.

- [ ] **Step 1: Modify HTML**

Insert this block in `/home/sbaikov/Desktop/Projects/logika/source/media-center.html` between `</section>` for `archive-section` and `<section class="news-section">`:

```html
    <section class="media-section">
      <div class="container">
        <div class="media-section__wrapp">
          <h2 class="media-section__title h2">Чому тисячі батьків обирають Logika</h2>

          <ul class="media-section__cards">
            <li class="media-section__card media-section__card--yellow media-section__card--tilt-left">
              <img class="media-section__image" src="img/media-center/why-logika/platform.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Єдина платформа – єдина якість</h3>
                <p>Інтерактивний підручник, практичні завдання й трекер результатів забезпечують високу якість навчання.</p>
              </div>
            </li>

            <li class="media-section__card media-section__card--purple media-section__card--tilt-right">
              <img class="media-section__image" src="img/media-center/why-logika/projects.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Мінімум 5 реальних проєктів за курс</h3>
                <p>Ігри, мультфільми, боти, сайти чи додатки - від ідеї до готового результату.</p>
              </div>
            </li>

            <li class="media-section__card media-section__card--green media-section__card--tilt-left">
              <img class="media-section__image" src="img/media-center/why-logika/open-lessons.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Відкриті уроки для батьків</h3>
                <p>Наприкінці модуля дитина презентує свої проєкти, а ви бачите реальний прогрес.</p>
              </div>
            </li>

            <li class="media-section__card media-section__card--purple media-section__card--tilt-left">
              <img class="media-section__image" src="img/media-center/why-logika/online-city.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Онлайн або у вашому місті</h3>
                <p>Займайтеся у школі Logika або онлайн у невеликих групах.</p>
              </div>
            </li>

            <li class="media-section__card media-section__card--green media-section__card--tilt-right">
              <img class="media-section__image" src="img/media-center/why-logika/teachers.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Викладачі з профільною освітою</h3>
                <p>Багаторівневий відбір, навчання за методологією Logika та досвід роботи з дітьми.</p>
              </div>
            </li>

            <li class="media-section__card media-section__card--yellow media-section__card--tilt-left">
              <img class="media-section__image" src="img/media-center/why-logika/game-method.png" alt="">
              <div class="media-section__content">
                <h3 class="media-section__card-title">Власна ігрова методика</h3>
                <p>Навчаємо через сюжети, практику та залучення, а не через суху теорію.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
```

- [ ] **Step 2: Replace placeholder SCSS**

Replace `/home/sbaikov/Desktop/Projects/logika/source/scss/blocks/sections/media-section.scss` with:

```scss
@import "../../general/mixins";

.media-section {
    padding: clamp(56px, 7.813vw, 100px) 0;
    overflow: hidden;
    background-color: var(--white);

    &__wrapp {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: clamp(32px, 4.167vw, 58px);
    }

    &__title {
        max-width: 900px;
        text-align: center;
        color: var(--blue-700);
    }

    &__cards {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: clamp(28px, 4.167vw, 54px) clamp(24px, 4.861vw, 70px);
        list-style: none;
        margin: 0;
        padding: 0 clamp(10px, 3.472vw, 50px);
    }

    &__card {
        min-height: clamp(260px, 22.917vw, 330px);
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        border-radius: 30px;
        padding: clamp(150px, 12.153vw, 175px) clamp(18px, 1.944vw, 28px) clamp(24px, 2.153vw, 31px);
        color: var(--white);
        isolation: isolate;

        &--yellow {
            background-color: #ffd631;
            color: #2f2535;
        }

        &--purple {
            background-color: #602a7a;
        }

        &--green {
            background-color: #95ca14;
        }

        &--tilt-left {
            transform: rotate(-4deg);
        }

        &--tilt-right {
            transform: rotate(4deg);
        }
    }

    &__image {
        position: absolute;
        left: 50%;
        top: clamp(-74px, -5.208vw, -48px);
        width: min(78%, 255px);
        height: auto;
        transform: translateX(-50%);
        pointer-events: none;
        z-index: -1;
    }

    &__content {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    &__card-title {
        margin: 0;
        font-size: clamp(20px, 1.667vw, 24px);
        font-weight: 700;
        line-height: 1.16;
        letter-spacing: 0;
    }

    p {
        margin: 0;
        font-size: clamp(13px, .972vw, 14px);
        font-weight: 600;
        line-height: 1.35;
        letter-spacing: 0;
    }

    @include laptop {
        &__cards {
            gap: 34px 28px;
            padding: 0;
        }
    }

    @include tablet {
        &__cards {
            max-width: 760px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    @include mobile {
        &__cards {
            max-width: 360px;
            grid-template-columns: 1fr;
            gap: 38px;
        }

        &__card {
            transform: none;
        }
    }
}
```

- [ ] **Step 3: Build Logika**

Run:

```bash
cd /home/sbaikov/Desktop/Projects/logika && npm run build
```

Expected: build completes and writes `/home/sbaikov/Desktop/Projects/logika/build/media-center.html`, CSS, and copied images.

- [ ] **Step 4: Verify output contains correct images and text**

Run:

```bash
rg -n "Чому тисячі батьків|why-logika/(platform|projects|open-lessons|online-city|teachers|game-method)\\.png|Власна ігрова методика" /home/sbaikov/Desktop/Projects/logika/build/media-center.html /home/sbaikov/Desktop/Projects/logika/build/css/blocks/sections/media-section.css
```

Expected: heading, all six image paths, and all six card titles appear.

- [ ] **Step 5: Browser screenshot verification**

Start a static server:

```bash
cd /home/sbaikov/Desktop/Projects/logika/build && python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/media-center.html` and capture desktop and mobile screenshots. Verify:

```text
Desktop: six cards are in two rows of three; every card has the matching illustration.
Mobile: cards stack one per row; text does not overflow; images are visible.
```

- [ ] **Step 6: Commit Logika changes**

```bash
git -C /home/sbaikov/Desktop/Projects/logika add source/media-center.html source/scss/blocks/sections/media-section.scss source/img/media-center/why-logika build/media-center.html build/css/blocks/sections/media-section.css build/img/media-center/why-logika
git -C /home/sbaikov/Desktop/Projects/logika commit -m "feat: add why parents choose Logika section"
```

---

### Task 7: Final Verification And Handoff

**Files:**
- No new source files.
- Verify both repositories.

**Interfaces:**
- Consumes: completed extractor commits and Logika section commit.
- Produces: final evidence report.

- [ ] **Step 1: Verify extractor cleanly**

Run:

```bash
cd /home/sbaikov/Desktop/Projects/fig-context-extracter
pnpm build
pnpm test
pnpm typecheck
rm -rf /tmp/figctx-logika-ready-final
node packages/cli/dist/main.js extract '/home/sbaikov/Downloads/Logika School UX_UI Design (2) (Copy).fig' --out /tmp/figctx-logika-ready-final
node packages/cli/dist/main.js pack /tmp/figctx-logika-ready-final --node '606-19569' --format codex > /tmp/figctx-logika-ready-final-pack.json
node -e "const fs=require('fs'); const pack=JSON.parse(fs.readFileSync('/tmp/figctx-logika-ready-final-pack.json','utf8')); if (pack.readyAssets.length < 6) throw new Error('Expected at least 6 ready assets, got '+pack.readyAssets.length); console.log('ready assets:', pack.readyAssets.length);"
```

Expected: build, tests, and typecheck pass; final command prints `ready assets: 6` or greater.

- [ ] **Step 2: Verify Logika cleanly**

Run:

```bash
cd /home/sbaikov/Desktop/Projects/logika
npm run build
rg -n "img/media-center/why-logika/(platform|projects|open-lessons|online-city|teachers|game-method)\\.png" build/media-center.html
```

Expected: build passes and six image references are present.

- [ ] **Step 3: Check git status**

Run:

```bash
git -C /home/sbaikov/Desktop/Projects/fig-context-extracter status --short
git -C /home/sbaikov/Desktop/Projects/logika status --short
```

Expected: only intentionally untracked local artifacts may remain, such as `.playwright-cli/` or `graphify-out/`; no source/build changes are unstaged.

- [ ] **Step 4: Final response**

Report:

```text
Extractor now emits ready PNG assets for vector-only Figma subtrees while preserving lossless vector blobs.
Logika media center now includes the "Чому тисячі батьків обирають Logika" section with six extracted illustrations mapped to the correct cards.
Verified with: pnpm build, pnpm test, pnpm typecheck, real Logika .fig extraction, npm run build, desktop/mobile browser screenshot.
```
