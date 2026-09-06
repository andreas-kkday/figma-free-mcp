import { FigctxError } from '../errors.js';

export interface AgentNode {
  /** Contextual ID. Materialized component descendants use a scoped ID. */
  id: string;
  /** Original Figma node ID, kept stable when `id` is scoped. */
  node_id: string;
  main_component_id?: string;
  name: string;
  type: string;
  parentId?: string;
  childIds: string[];
  zIndex: number;
  text?: string;
  textSegments?: TextSegment[];
  bounds?: unknown;
  transform?: unknown;
  constraints?: { horizontal?: unknown; vertical?: unknown };
  layout?: Record<string, unknown>;
  fills?: unknown;
  strokes?: unknown;
  effects?: unknown;
  typography?: Record<string, unknown>;
  styleRefs?: StyleReferences;
  variableBindings?: VariableBinding[];
  textLayout?: Record<string, unknown>;
  visible?: boolean;
  opacity?: number;
  blendMode?: unknown;
  mask?: boolean;
  frameMaskDisabled?: boolean;
  assetRefs: AssetReference[];
  vectorRef?: VectorReference;
}

export interface TextSegment { start: number; end: number; text: string; styleId: number; typography: Record<string, unknown>; fills?: unknown; }
export interface StyleReferences { text?: string; effects?: string; strokeFill?: string; }
export interface VariableBinding { field: string; variableId: string; resolvedType?: string; }
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

  // Figma stores instances of library components without their instance
  // children.  The matching SYMBOL is commonly embedded in the same canvas,
  // even though its session ID differs. Materialize that subtree under the
  // instance so consumers do not lose the component's content.
  materializeExternalInstances(nodesById, changes);
  return { contractVersion: '1', ...(options.originFileKey ? { originFileKey: options.originFileKey } : {}), rootIds: roots, nodesById };
}

function materializeExternalInstances(nodesById: Record<string, AgentNode>, changes: readonly Record<string, unknown>[]): void {
  const originals = Object.values(nodesById);
  for (const instance of originals) {
    if (instance.type !== 'INSTANCE' || instance.childIds.length > 0) continue;
    const sourceId = guidId(record(record(changes[instance.zIndex]?.symbolData)?.symbolID));
    const source = sourceId ? nodesById[sourceId] : undefined;
    if (!source || source.type !== 'SYMBOL') continue;

    const sourceIds = new Set<string>();
    const collect = (id: string) => {
      if (sourceIds.has(id)) return;
      const node = nodesById[id];
      if (!node) return;
      sourceIds.add(id);
      node.childIds.forEach(collect);
    };
    source.childIds.forEach(collect);

    const clonedIds = new Map<string, string>();
    for (const id of sourceIds) {
      // Always scope the stable source node ID. A source node may itself have
      // come from a materialized component, so using its contextual `id` here
      // would produce paths such as `/component/.../component/...`.
      const sourceNode = nodesById[id]!;
      clonedIds.set(id, `${instance.id}/component/${sourceNode.node_id}`);
    }
    for (const id of sourceIds) {
      const original = nodesById[id]!;
      const clone: AgentNode = structuredClone(original);
      clone.id = clonedIds.get(id)!;
      clone.node_id = original.node_id;
      clone.main_component_id = sourceId;
      clone.parentId = original.parentId === source.id ? instance.id : clonedIds.get(original.parentId ?? '');
      clone.childIds = original.childIds.flatMap((childId) => clonedIds.get(childId) ? [clonedIds.get(childId)!] : []);
      nodesById[clone.id] = clone;
    }
    instance.childIds = source.childIds.flatMap((id) => clonedIds.get(id) ? [clonedIds.get(id)!] : []);
  }
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
  const typographyKeys = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlignHorizontal', 'textAlignVertical', 'fontVariantCommonLigatures', 'fontVariantContextualLigatures', 'fontVariations', 'textTracking', 'textCase', 'textDecoration'];
  const typography = pick(change, typographyKeys);
  const derivedTextData = record(change.derivedTextData);
  const textLayout = derivedTextData ? pick(derivedTextData, ['layoutSize', 'baselines', 'fontMetaData', 'truncationStartIndex', 'truncatedHeight', 'derivedLines']) : undefined;
  const segments = textSegments(textData, typography, change.fillPaints);
  const styles = styleReferences(change);
  const bindings = variableBindings(change);
  const mainComponentId = guidId(record(record(change.symbolData)?.symbolID));
  return {
    id, node_id: id, ...(mainComponentId ? { main_component_id: mainComponentId } : {}), name: typeof change.name === 'string' ? change.name : id, type: typeof change.type === 'string' ? change.type : 'UNKNOWN', childIds: [], zIndex,
    ...(typeof textData?.characters === 'string' ? { text: textData.characters } : {}), ...(segments ? { textSegments: segments } : {}), ...(textLayout && Object.keys(textLayout).length ? { textLayout } : {}),
    ...(change.size === undefined ? {} : { bounds: change.size }), ...(change.transform === undefined ? {} : { transform: change.transform }),
    ...(typeof change.visible === 'boolean' ? { visible: change.visible } : {}), ...(typeof change.opacity === 'number' ? { opacity: change.opacity } : {}), ...(change.blendMode === undefined ? {} : { blendMode: change.blendMode }), ...(typeof change.mask === 'boolean' ? { mask: change.mask } : {}), ...(typeof change.frameMaskDisabled === 'boolean' ? { frameMaskDisabled: change.frameMaskDisabled } : {}), constraints: { horizontal: change.horizontalConstraint, vertical: change.verticalConstraint },
    layout: pick(change, layoutKeys), fills: change.fillPaints, strokes: change.strokePaints, effects: change.effects, typography, ...(styles ? { styleRefs: styles } : {}), ...(bindings ? { variableBindings: bindings } : {}), assetRefs: assetReferences(change.fillPaints, assetPaths), ...(vectorReference(change.vectorData, vectorPaths, vectorSvgPaths) ? { vectorRef: vectorReference(change.vectorData, vectorPaths, vectorSvgPaths) } : {})
  };
}

function textSegments(textData: Record<string, unknown> | undefined, baseTypography: Record<string, unknown>, baseFills: unknown): TextSegment[] | undefined {
  if (!textData) return undefined;
  const text = typeof textData.characters === 'string' ? textData.characters : undefined;
  const styleIds = textData.characterStyleIDs;
  if (!text || !Array.isArray(styleIds) || styleIds.length !== text.length || !styleIds.some((styleId) => typeof styleId === 'number' && styleId !== 0)) return undefined;
  const overrides = new Map((Array.isArray(textData.styleOverrideTable) ? textData.styleOverrideTable : []).flatMap((entry) => {
    const style = record(entry); const styleId = style?.styleID;
    return typeof styleId === 'number' ? [[styleId, style] as const] : [];
  }));
  const typographyKeys = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlignHorizontal', 'textAlignVertical', 'fontVariantCommonLigatures', 'fontVariantContextualLigatures', 'fontVariations', 'textTracking', 'textCase', 'textDecoration'];
  const segments: TextSegment[] = [];
  for (let start = 0; start < styleIds.length;) {
    const styleId = typeof styleIds[start] === 'number' ? styleIds[start] : 0;
    let end = start + 1;
    while (end < styleIds.length && styleIds[end] === styleId) end += 1;
    const override = overrides.get(styleId);
    segments.push({ start, end, text: text.slice(start, end), styleId, typography: { ...baseTypography, ...pick(override ?? {}, typographyKeys) }, ...((override?.fillPaints ?? baseFills) === undefined ? {} : { fills: override?.fillPaints ?? baseFills }) });
    start = end;
  }
  return segments;
}

function styleReferences(change: Record<string, unknown>): StyleReferences | undefined {
  const refs = {
    text: guidId(record(change.styleIdForText)?.guid),
    effects: guidId(record(change.styleIdForEffect)?.guid),
    strokeFill: guidId(record(change.styleIdForStrokeFill)?.guid)
  };
  return Object.values(refs).some(Boolean) ? refs : undefined;
}

function variableBindings(change: Record<string, unknown>): VariableBinding[] | undefined {
  const entries = record(change.variableConsumptionMap)?.entries;
  if (!Array.isArray(entries)) return undefined;
  const bindings = entries.flatMap((entry) => {
    const value = record(record(record(entry)?.variableData)?.value);
    const variableId = guidId(record(value?.alias)?.guid);
    const field = record(entry)?.variableField;
    const resolvedType = record(record(entry)?.variableData)?.resolvedDataType;
    return typeof field === 'string' && variableId ? [{ field, variableId, ...(typeof resolvedType === 'string' ? { resolvedType } : {}) }] : [];
  });
  return bindings.length ? bindings : undefined;
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
function guidId(value: unknown): string | undefined { const guid = record(value); return typeof guid?.sessionID === 'number' && typeof guid.localID === 'number' ? `${guid.sessionID}:${guid.localID}` : undefined; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> { return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])); }
