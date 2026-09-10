import { basename } from 'node:path';
import { readFigArchive } from './archive/read-archive.js';
import { writeBundle } from './bundle/write-bundle.js';
import { decodeKiwiCanvas } from './decoder/kiwi.js';
import { normalizeDocument, type AgentDocument } from './normalize/document.js';
import { extensionForAsset } from './assets.js';
import { extractTokens, extractVariables } from './tokens/extract.js';
import { vectorNetworkToSvg } from './vectors/svg.js';

export interface ExtractionResult { agent: AgentDocument; outDir: string; }

export async function extractFig(sourcePath: string, outDir: string): Promise<ExtractionResult> {
  const archive = await readFigArchive(sourcePath);
  const decoded = decodeKiwiCanvas(archive.canvas);
  const assetPaths = Object.fromEntries(archive.images.map((image) => [image.hash, `assets/images/${image.hash}.${extensionForAsset(image.format) ?? 'bin'}`]));
  const originFileKey = typeof decoded.document.originFileKey === 'string' ? decoded.document.originFileKey : undefined;
  const vectorNames = vectorResourceNames(decoded.nodeChanges);
  const referencedVectorBlobs = new Set(decoded.nodeChanges.flatMap((change) => {
    const vectorData = change.vectorData;
    const blobId = vectorData && typeof vectorData === 'object' && !Array.isArray(vectorData) ? (vectorData as Record<string, unknown>).vectorNetworkBlob : undefined;
    return typeof blobId === 'number' ? [blobId] : [];
  }));
  const vectors = decoded.blobs.flatMap((blob, blobId) => {
    if (!referencedVectorBlobs.has(blobId)) return [];
    const bytes = blob && typeof blob === 'object' && 'bytes' in blob && (blob as { bytes?: unknown }).bytes instanceof Uint8Array ? (blob as { bytes: Uint8Array }).bytes : undefined;
    return bytes ? [{ blobId, bytes, name: vectorNames[blobId] }] : [];
  });
  const vectorPaths = Object.fromEntries(vectors.map((vector) => [vector.blobId, `assets/vectors/vector-network-${vector.blobId}.bin.gz`]));
  const vectorNodes = new Map(decoded.nodeChanges.flatMap((change) => {
    const blobId = record(change.vectorData)?.vectorNetworkBlob;
    return typeof blobId === 'number' ? [[blobId, change] as const] : [];
  }));
  const svgVectors = vectors.flatMap((vector) => {
    const svg = vectorSvg(vectorNodes.get(vector.blobId), vector.bytes);
    return svg ? [{ blobId: vector.blobId, svg }] : [];
  });
  const vectorSvgPaths = Object.fromEntries(svgVectors.map((vector) => [vector.blobId, `assets/vectors/vector-network-${vector.blobId}.svg`]));
  const agent = normalizeDocument(decoded.nodeChanges, { originFileKey, assetPaths, vectorPaths, vectorSvgPaths, vectorNames });
  const variables = extractVariables(decoded.nodeChanges);
  const warnings = agent.nodesById && Object.values(agent.nodesById).some((node) => node.styleRefs) && !decoded.nodeChanges.some((change) => change.type === 'STYLE')
    ? ['STYLE_DEFINITIONS_UNAVAILABLE']
    : [];
  await writeBundle({
    outDir,
    manifest: { contractVersion: '1', parserVersion: decoded.decoderVersion, status: 'success', sourceFilename: basename(sourcePath), sourceSha256: archive.sourceSha256, ...(originFileKey ? { originFileKey } : {}), canvasVariant: archive.canvasVariant, nodeCount: decoded.nodeChanges.length, visualBaseline: archive.thumbnail ? 'assets/thumbnail.png' : undefined, ...(warnings.length ? { warnings } : {}) },
    raw: { decoderVersion: decoded.decoderVersion, canvasVersion: decoded.canvasVersion, document: decoded.document },
    agent,
    schemaBytes: decoded.schemaBytes,
    images: archive.images, vectors, svgVectors, thumbnail: archive.thumbnail, tokens: extractTokens(agent), variables
  });
  return { agent, outDir };
}

function vectorSvg(node: Record<string, unknown> | undefined, bytes: Uint8Array): string | undefined {
  const size = record(node?.size);
  const normalized = record(record(node?.vectorData)?.normalizedSize);
  const viewBox = normalized && typeof normalized.x === 'number' && typeof normalized.y === 'number' && normalized.x > 0 && normalized.y > 0 ? normalized : size;
  return typeof viewBox?.x === 'number' && typeof viewBox.y === 'number' ? vectorNetworkToSvg(bytes, { x: viewBox.x, y: viewBox.y }) : undefined;
}

function vectorResourceNames(changes: readonly Record<string, unknown>[]): Record<number, string> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const change of changes) { const id = guidId(change.guid); if (id) byId.set(id, change); }
  const names: Record<number, string> = {};
  for (const change of changes) {
    const blobId = record(change.vectorData)?.vectorNetworkBlob;
    if (typeof blobId !== 'number') continue;
    let parent = record(change.parentIndex)?.guid;
    while (parent) {
      const node = byId.get(guidId(parent) ?? '');
      if (!node) break;
      if (node.type === 'FRAME' && typeof node.name === 'string' && node.name !== 'Frame') { names[blobId] = `${node.name}-${blobId}`; break; }
      parent = record(node.parentIndex)?.guid;
    }
  }
  return names;
}

function guidId(value: unknown): string | undefined {
  const guid = record(value);
  return typeof guid?.sessionID === 'number' && typeof guid.localID === 'number' ? `${guid.sessionID}:${guid.localID}` : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
