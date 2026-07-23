import { FigctxError } from '../errors.js';

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
  mask?: boolean;
  frameMaskDisabled?: boolean;
  assetRefs: AssetReference[];
  vectorRef?: VectorReference;
}

export interface AssetReference { hash: string; path: string; kind: 'image-fill'; }
export interface VectorReference { blobId: number; path: string; format: 'kiwi-vector-network'; compression: 'gzip'; svgPath?: string; }

export interface AgentDocument {
  contractVersion: '1';
  originFileKey?: string;
  rootIds: string[];
  nodesById: Record<string, AgentNode>;
}

export interface NormalizeOptions { originFileKey?: string; assetPaths?: Readonly<Record<string, string>>; vectorPaths?: Readonly<Record<number, string>>; vectorSvgPaths?: Readonly<Record<number, string>>; }

export function normalizeDocument(changes: readonly Record<string, unknown>[], options: NormalizeOptions = {}): AgentDocument {
  const nodes = changes.map((change, zIndex) => normalizeNode(change, zIndex, options.assetPaths, options.vectorPaths, options.vectorSvgPaths));
  const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const roots: string[] = [];
  changes.forEach((change, index) => {
    const parentIndex = typeof change.parentIndex === 'number' ? change.parentIndex : undefined;
    const node = nodes[index]!;
    const parentRef = record(change.parentIndex);
    const parentId = parentRef?.guid === undefined ? undefined : idFromGuid(parentRef.guid, -1);
    const parent = parentIndex === undefined ? (parentId ? nodesById[parentId] : undefined) : nodes[parentIndex];
    if (!parent || parent.id === node.id) roots.push(node.id);
    else { node.parentId = parent.id; parent.childIds.push(node.id); }
  });
  return { contractVersion: '1', ...(options.originFileKey ? { originFileKey: options.originFileKey } : {}), rootIds: roots, nodesById };
}

export function resolveNodeReference(document: AgentDocument, reference: string): AgentNode {
  const urlFileKey = fileKeyFromReference(reference);
  if (urlFileKey && document.originFileKey && urlFileKey !== document.originFileKey) throw new FigctxError('NODE_REFERENCE_FILE_MISMATCH', `Figma URL belongs to ${urlFileKey}, but this bundle is for ${document.originFileKey}.`);
  const id = canonicalNodeId(reference);
  const node = document.nodesById[id];
  if (!node) throw new FigctxError('NODE_NOT_FOUND', `No node matches ${reference}.`);
  return node;
}

export function canonicalNodeId(reference: string): string {
  const raw = reference.includes('://') ? extractUrlNodeId(reference) : reference;
  const decoded = decodeURIComponent(raw).trim();
  const match = decoded.match(/^(\d+)[-:](\d+)$/);
  if (!match) throw new FigctxError('NODE_NOT_FOUND', `Invalid node reference: ${reference}`);
  return `${match[1]}:${match[2]}`;
}

function extractUrlNodeId(reference: string): string {
  const url = new URL(reference);
  const value = url.searchParams.get('node-id') ?? url.hash.match(/node-id=([^&]+)/)?.[1];
  if (!value) throw new FigctxError('NODE_NOT_FOUND', 'Figma URL has no node-id parameter.');
  return value;
}

function fileKeyFromReference(reference: string): string | undefined {
  if (!reference.includes('://')) return undefined;
  try { const match = new URL(reference).pathname.match(/\/(?:design|file)\/([^/?#]+)/i); return match?.[1] ? decodeURIComponent(match[1]) : undefined; } catch { return undefined; }
}

function normalizeNode(change: Record<string, unknown>, zIndex: number, assetPaths: Readonly<Record<string, string>> | undefined, vectorPaths: Readonly<Record<number, string>> | undefined, vectorSvgPaths: Readonly<Record<number, string>> | undefined): AgentNode {
  const id = idFromGuid(change.guid, zIndex);
  const textData = record(change.textData);
  const layoutKeys = ['stackMode', 'stackSpacing', 'stackHorizontalPadding', 'stackVerticalPadding', 'stackPrimaryAlignItems', 'stackCounterAlignItems'];
  const typographyKeys = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlignHorizontal', 'textAlignVertical', 'fontVariantCommonLigatures', 'fontVariantContextualLigatures', 'fontVariations', 'textTracking'];
  const derivedTextData = record(change.derivedTextData);
  const textLayout = derivedTextData ? pick(derivedTextData, ['layoutSize', 'baselines', 'fontMetaData', 'truncationStartIndex', 'truncatedHeight', 'derivedLines']) : undefined;
  return {
    id, name: typeof change.name === 'string' ? change.name : id, type: typeof change.type === 'string' ? change.type : 'UNKNOWN', childIds: [], zIndex,
    ...(typeof textData?.characters === 'string' ? { text: textData.characters } : {}), ...(textLayout && Object.keys(textLayout).length ? { textLayout } : {}),
    ...(change.size === undefined ? {} : { bounds: change.size }), ...(change.transform === undefined ? {} : { transform: change.transform }),
    ...(typeof change.visible === 'boolean' ? { visible: change.visible } : {}), ...(typeof change.opacity === 'number' ? { opacity: change.opacity } : {}), ...(change.blendMode === undefined ? {} : { blendMode: change.blendMode }), ...(typeof change.mask === 'boolean' ? { mask: change.mask } : {}), ...(typeof change.frameMaskDisabled === 'boolean' ? { frameMaskDisabled: change.frameMaskDisabled } : {}), constraints: { horizontal: change.horizontalConstraint, vertical: change.verticalConstraint },
    layout: pick(change, layoutKeys), fills: change.fillPaints, strokes: change.strokePaints, effects: change.effects, typography: pick(change, typographyKeys), assetRefs: assetReferences(change.fillPaints, assetPaths), ...(vectorReference(change.vectorData, vectorPaths, vectorSvgPaths) ? { vectorRef: vectorReference(change.vectorData, vectorPaths, vectorSvgPaths) } : {})
  };
}
function vectorReference(value: unknown, vectorPaths: Readonly<Record<number, string>> | undefined, vectorSvgPaths: Readonly<Record<number, string>> | undefined): VectorReference | undefined {
  const blobId = record(value)?.vectorNetworkBlob;
  if (typeof blobId !== 'number') return undefined;
  const path = vectorPaths?.[blobId];
  return path ? { blobId, path, format: 'kiwi-vector-network', compression: 'gzip', ...(vectorSvgPaths?.[blobId] ? { svgPath: vectorSvgPaths[blobId] } : {}) } : undefined;
}
function assetReferences(value: unknown, assetPaths: Readonly<Record<string, string>> | undefined): AssetReference[] {
  if (!Array.isArray(value) || !assetPaths) return [];
  const refs: AssetReference[] = [];
  for (const paint of value) { const hash = hashToHex(record(record(paint)?.image)?.hash); if (!hash) continue; const path = assetPaths[hash]; if (path) refs.push({ hash, path, kind: 'image-fill' }); }
  return refs;
}
export function hashToHex(value: unknown): string | undefined {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  const bytes = record(value); if (!bytes) return undefined;
  const values = Object.keys(bytes).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b)).map((key) => bytes[key]);
  return values.length === 20 && values.every((byte) => typeof byte === 'number' && byte >= 0 && byte <= 255) ? Buffer.from(values as number[]).toString('hex') : undefined;
}
function idFromGuid(value: unknown, fallback: number): string { const guid = record(value); return typeof guid?.sessionID === 'number' && typeof guid.localID === 'number' ? `${guid.sessionID}:${guid.localID}` : `index:${fallback}`; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> { return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])); }
