import { FigctxError } from '../errors.js';

export interface AgentNode {
  /** Contextual ID. Materialized component descendants use a scoped ID. */
  id: string;
  /** Original Figma node ID, kept stable when `id` is scoped. */
  node_id: string;
  main_component_id?: string;
  /** Expanded child IDs when an INSTANCE has a resolved component subtree. */
  resolvedChildIds?: string[];
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
  strokeWeight?: number;
  strokeCap?: string;
  strokeJoin?: string;
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
  /** Component properties consumed by this node (used to resolve instance overrides and slots). */
  componentPropRefs?: Array<{ defId: string; field: string }>;
}

export interface TextSegment { start: number; end: number; text: string; styleId: number; typography: Record<string, unknown>; fills?: unknown; }
export interface StyleReferences { text?: string; effects?: string; strokeFill?: string; }
export interface VariableBinding { field: string; variableId: string; resolvedType?: string; }
export interface AssetReference { hash: string; path: string; kind: 'image-fill'; }
export interface VectorReference { blobId: number; path: string; format: 'kiwi-vector-network'; compression: 'gzip'; normalizedSize?: { x: number; y: number }; svgPath?: string; name?: string; }

export interface AgentDocument {
  contractVersion: '1';
  originFileKey?: string;
  rootIds: string[];
  nodesById: Record<string, AgentNode>;
}

export interface NormalizeOptions { originFileKey?: string; assetPaths?: Readonly<Record<string, string>>; vectorPaths?: Readonly<Record<number, string>>; vectorSvgPaths?: Readonly<Record<number, string>>; vectorNames?: Readonly<Record<number, string>>; }

export function normalizeDocument(changes: readonly Record<string, unknown>[], options: NormalizeOptions = {}): AgentDocument {
  const nodes = changes.map((change, zIndex) => normalizeNode(change, zIndex, options.assetPaths, options.vectorPaths, options.vectorSvgPaths, options.vectorNames));
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
  // children. The matching SYMBOL is commonly embedded in the same canvas,
  // even though its session ID differs. Materialize that subtree under the
  // instance so consumers do not lose component content or instance overrides.
  materializeExternalInstances(nodesById, changes);
  return { contractVersion: '1', ...(options.originFileKey ? { originFileKey: options.originFileKey } : {}), rootIds: roots, nodesById };
}

function materializeExternalInstances(nodesById: Record<string, AgentNode>, changes: readonly Record<string, unknown>[]): void {
  const originals = Object.values(nodesById);
  const rawChildIds = new Map(originals.map((node) => [node.id, [...node.childIds]] as const));
  for (const instance of originals) {
    if (instance.type !== 'INSTANCE' || instance.childIds.length > 0) continue;
    const sourceId = guidId(record(record(changes[instance.zIndex]?.symbolData)?.symbolID));
    const source = sourceId ? nodesById[sourceId] : undefined;
    if (!source || source.type !== 'SYMBOL') continue;

    const sourceIds = new Set<string>();
    // A nested INSTANCE borrows its children from its symbol, but those
    // children belong to the nested instance in the materialized tree (not to
    // the source SYMBOL). Keep that virtual parent relationship explicitly.
    const effectiveParent = new Map<string, string>();
    const childrenFor = (id: string): string[] => {
      const raw = rawChildIds.get(id) ?? [];
      if (raw.length) return [...raw];
      const node = nodesById[id];
      const nestedSourceId = node?.type === 'INSTANCE' ? guidId(record(record(changes[node.zIndex]?.symbolData)?.symbolID)) : undefined;
      return nestedSourceId ? [...(rawChildIds.get(nestedSourceId) ?? [])] : [];
    };
    const collect = (id: string, parentId?: string) => {
      if (sourceIds.has(id)) return;
      const node = nodesById[id];
      if (!node) return;
      sourceIds.add(id);
      if (parentId) effectiveParent.set(id, parentId);
      childrenFor(id).forEach((childId) => collect(childId, id));
    };
    childrenFor(source.id).forEach((childId) => collect(childId, source.id));

    const overrides = new Map<string, Record<string, unknown>>();
    const propertyAssignments = new Map<string, Record<string, unknown>>();
    const collectAssignments = (change: Record<string, unknown> | undefined) => {
      for (const assignment of componentPropAssignments(change)) propertyAssignments.set(assignment.defId, assignment.value);
      for (const [nodeId, override] of symbolOverrides(change)) {
        overrides.set(nodeId, override);
        for (const assignment of componentPropAssignments(override)) propertyAssignments.set(assignment.defId, assignment.value);
      }
    };
    for (const id of sourceIds) {
      const nested = nodesById[id];
      if (nested?.type === 'INSTANCE') collectAssignments(changes[nested.zIndex]);
    }
    // The outer instance wins over defaults and nested-instance assignments.
    collectAssignments(changes[instance.zIndex]);
    const clonedIds = new Map<string, string>();
    const nestedSymbolOverrides = new Map<string, Record<string, unknown>>();
    for (const id of sourceIds) {
      const sourceNode = nodesById[id]!;
      const parentSourceId = effectiveParent.get(id) ?? sourceNode.parentId;
      const cloneParentId = parentSourceId === source.id ? instance.id : clonedIds.get(parentSourceId ?? '') ?? instance.id;
      clonedIds.set(id, `${cloneParentId}/component/${sourceNode.node_id}`);
    }
    for (const id of sourceIds) {
      const original = nodesById[id]!;
      const clone: AgentNode = structuredClone(original);
      clone.id = clonedIds.get(id)!;
      clone.node_id = original.node_id;
      clone.main_component_id = sourceId;
      const parentSourceId = effectiveParent.get(id) ?? original.parentId;
      clone.parentId = parentSourceId === source.id ? instance.id : clonedIds.get(parentSourceId ?? '');
      clone.childIds = childrenFor(original.id).flatMap((childId) => clonedIds.get(childId) ? [clonedIds.get(childId)!] : []);
      if (clone.type === 'INSTANCE') {
        const nestedSourceId = guidId(record(record(changes[original.zIndex]?.symbolData)?.symbolID));
        clone.main_component_id = nestedSourceId ?? sourceId;
        clone.resolvedChildIds = [...clone.childIds];
      }
      else delete clone.resolvedChildIds;
      const overrideKey = guidId(record(changes[original.zIndex]?.overrideKey));
      const sourceOverride = overrides.get(original.node_id) ?? (overrideKey ? overrides.get(overrideKey) : undefined);
      applySymbolOverride(clone, sourceOverride);
      applyComponentProperty(clone, propertyAssignments);
      nodesById[clone.id] = clone;
      if (clone.type === 'INSTANCE' && sourceOverride?.overriddenSymbolID) nestedSymbolOverrides.set(clone.id, sourceOverride);
    }
    materializeNestedSymbolOverrides(nestedSymbolOverrides, nodesById, rawChildIds, propertyAssignments);
    materializeOverriddenComponentSymbols(clonedIds, sourceIds, nodesById, rawChildIds, propertyAssignments);
    instance.resolvedChildIds = childrenFor(source.id).flatMap((id) => clonedIds.get(id) ? [clonedIds.get(id)!] : []);
    instance.childIds = [...instance.resolvedChildIds];
    // A slot assignment supplies an instance-owned subtree in place of the
    // component's placeholder children. Keep the supplied nodes addressable;
    // traversal is based on childIds and therefore remains complete for MCP.
    for (const id of sourceIds) {
      const clone = nodesById[clonedIds.get(id)!];
      if (!clone || !clone.componentPropRefs?.some((ref) => ref.field === 'SLOT_CONTENT_ID')) continue;
      const slot = componentPropAssignments(changes[instance.zIndex]).find((assignment) => clone.componentPropRefs?.some((ref) => ref.defId === assignment.defId));
      const contentId = slot ? slotContentId(slot.value) : undefined;
      if (contentId) clone.childIds = effectiveChildrenFor(nodesById, contentId);
    }
    materializeOverriddenSymbols(instance, changes, nodesById, rawChildIds);
  }
}

function materializeOverriddenSymbols(instance: AgentNode, changes: readonly Record<string, unknown>[], nodesById: Record<string, AgentNode>, rawChildIds: ReadonlyMap<string, readonly string[]>): void {
  const entries = record(changes[instance.zIndex]?.symbolData)?.symbolOverrides;
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const override = record(entry);
    // A guidPath identifies a nested instance override. It is resolved against
    // that nested instance, not appended as a new child of the outer instance.
    if (record(override?.guidPath)) continue;
    const sourceId = guidId(override?.overriddenSymbolID);
    const source = sourceId ? nodesById[sourceId] : undefined;
    if (!source) continue;
    const sourceIds: string[] = [];
    const collect = (id: string) => { if (sourceIds.includes(id)) return; sourceIds.push(id); for (const child of rawChildIds.get(id) ?? []) collect(child); };
    collect(source.id);
    const clonedIds = new Map(sourceIds.map((id) => [id, `${instance.id}/override/${id}`] as const));
    for (const id of sourceIds) {
      const original = nodesById[id]; if (!original) continue;
      const clone = structuredClone(original);
      clone.id = clonedIds.get(id)!; clone.node_id = original.node_id; clone.main_component_id = sourceId;
      clone.parentId = original.id === source.id ? instance.id : clonedIds.get(original.parentId ?? '');
      clone.childIds = (rawChildIds.get(id) ?? []).flatMap((child) => clonedIds.get(child) ? [clonedIds.get(child)!] : []);
      nodesById[clone.id] = clone;
    }
    instance.childIds.push(clonedIds.get(source.id)!);
    instance.resolvedChildIds = [...instance.childIds];
  }
}

/** Returns the child IDs consumers should traverse after local expansion. */
export function effectiveChildIds(node: AgentNode): string[] {
  return node.resolvedChildIds?.length ? node.resolvedChildIds : node.childIds;
}

export function resolveNodeReference(document: AgentDocument, reference: string): AgentNode {
  const direct = document.nodesById[reference];
  if (direct) return direct;
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

function componentPropAssignments(change: Record<string, unknown> | undefined): Array<{ defId: string; value: Record<string, unknown> }> {
  const entries = Array.isArray(change?.componentPropAssignments) ? change.componentPropAssignments : [];
  return entries.flatMap((entry) => {
    const value = record(entry)?.varValue;
    const defId = guidId(record(record(entry)?.defID));
    return defId && value ? [{ defId, value: value as Record<string, unknown> }] : [];
  });
}

function componentPropRefs(change: Record<string, unknown>): Array<{ defId: string; field: string }> | undefined {
  const entries = Array.isArray(change.componentPropRefs) ? change.componentPropRefs : [];
  const refs = entries.flatMap((entry) => {
    const ref = record(entry); const defId = guidId(ref?.defID); const field = ref?.componentPropNodeField;
    return defId && typeof field === 'string' ? [{ defId, field }] : [];
  });
  const parameterEntries = record(change.parameterConsumptionMap)?.entries;
  if (Array.isArray(parameterEntries)) for (const entry of parameterEntries) {
    const variableData = record(record(entry)?.variableData);
    const propRef = record(record(variableData?.value)?.propRefValue);
    const defId = guidId(record(propRef?.defId));
    const field = variableData?.resolvedDataType;
    if (defId && typeof field === 'string') refs.push({ defId, field });
  }
  return refs.length ? refs : undefined;
}

function slotContentId(value: Record<string, unknown>): string | undefined {
  const guid = record(record(record(value.value)?.slotContentIdValue)?.guid);
  return guidId(guid);
}

function effectiveChildrenFor(nodesById: Record<string, AgentNode>, id: string): string[] {
  const node = nodesById[id];
  return node ? effectiveChildIds(node) : [];
}

function applyComponentProperty(node: AgentNode, assignments: Map<string, Record<string, unknown>>): void {
  for (const ref of node.componentPropRefs ?? []) {
    const assignment = assignments.get(ref.defId);
    if (!assignment) continue;
    const textData = record(record(assignment.value)?.textDataValue) ?? record(record(assignment.value)?.textValue);
    if (ref.field === 'TEXT_DATA' && typeof textData?.characters === 'string') node.text = textData.characters;
    if (ref.field === 'VISIBLE' && typeof record(assignment.value)?.boolValue === 'boolean') node.visible = record(assignment.value)!.boolValue as boolean;
  }
}

function materializeNestedSymbolOverrides(overrides: ReadonlyMap<string, Record<string, unknown>>, nodesById: Record<string, AgentNode>, rawChildIds: ReadonlyMap<string, readonly string[]>, assignments: Map<string, Record<string, unknown>>): void {
  for (const [instanceId, override] of overrides) {
    const instance = nodesById[instanceId];
    const symbolId = guidId(record(override.overriddenSymbolID));
    const symbol = symbolId ? nodesById[symbolId] : undefined;
    if (!instance || instance.type !== 'INSTANCE' || !symbol || symbol.type !== 'SYMBOL') continue;

    const descendantIds: string[] = [];
    const collect = (id: string) => {
      if (descendantIds.includes(id) || !nodesById[id]) return;
      descendantIds.push(id);
      for (const childId of rawChildIds.get(id) ?? []) collect(childId);
    };
    for (const childId of rawChildIds.get(symbol.id) ?? []) collect(childId);

    const cloneIds = new Map(descendantIds.map((id) => [id, `${instance.id}/component/${nodesById[id]!.node_id}`] as const));
    for (const id of descendantIds) {
      const original = nodesById[id]!;
      const clone = structuredClone(original);
      clone.id = cloneIds.get(id)!;
      clone.node_id = original.node_id;
      clone.main_component_id = symbolId;
      clone.parentId = original.parentId === symbol.id ? instance.id : cloneIds.get(original.parentId ?? '');
      clone.childIds = (rawChildIds.get(id) ?? []).flatMap((childId) => cloneIds.get(childId) ? [cloneIds.get(childId)!] : []);
      if (clone.type === 'INSTANCE') clone.resolvedChildIds = [...clone.childIds];
      else delete clone.resolvedChildIds;
      applyComponentProperty(clone, assignments);
      nodesById[clone.id] = clone;
    }
    instance.main_component_id = symbolId;
    instance.childIds = (rawChildIds.get(symbol.id) ?? []).flatMap((id) => cloneIds.get(id) ? [cloneIds.get(id)!] : []);
    instance.resolvedChildIds = [...instance.childIds];
  }
}

function materializeOverriddenComponentSymbols(clonedIds: ReadonlyMap<string, string>, sourceIds: ReadonlySet<string>, nodesById: Record<string, AgentNode>, rawChildIds: ReadonlyMap<string, readonly string[]>, assignments: Map<string, Record<string, unknown>>): void {
  for (const originalId of sourceIds) {
    const original = nodesById[originalId];
    const cloneId = clonedIds.get(originalId);
    const clone = cloneId ? nodesById[cloneId] : undefined;
    if (!original || !clone || clone.type !== 'INSTANCE') continue;
    const ref = clone.componentPropRefs?.find((item) => item.field === 'OVERRIDDEN_SYMBOL_ID');
    const overriddenSymbolId = ref ? guidId(record(record(assignments.get(ref.defId)?.value)?.symbolIdValue)?.guid) : undefined;
    const overriddenSymbol = overriddenSymbolId ? nodesById[overriddenSymbolId] : undefined;
    if (!overriddenSymbol || overriddenSymbol.type !== 'SYMBOL') continue;

    const descendants: string[] = [];
    const collect = (id: string) => {
      if (descendants.includes(id)) return;
      if (!nodesById[id]) return;
      descendants.push(id);
      for (const childId of rawChildIds.get(id) ?? []) collect(childId);
    };
    for (const childId of rawChildIds.get(overriddenSymbol.id) ?? []) collect(childId);
    const overrideIds = new Map(descendants.map((id) => [id, `${clone.id}/component/${nodesById[id]!.node_id}`] as const));
    for (const id of descendants) {
      const sourceNode = nodesById[id]!;
      const replacement = structuredClone(sourceNode);
      replacement.id = overrideIds.get(id)!;
      replacement.node_id = sourceNode.node_id;
      replacement.main_component_id = overriddenSymbolId;
      replacement.parentId = sourceNode.parentId === overriddenSymbol.id ? clone.id : overrideIds.get(sourceNode.parentId ?? '');
      replacement.childIds = (rawChildIds.get(id) ?? []).flatMap((childId) => overrideIds.get(childId) ? [overrideIds.get(childId)!] : []);
      if (replacement.type === 'INSTANCE') replacement.resolvedChildIds = [...replacement.childIds];
      else delete replacement.resolvedChildIds;
      applyComponentProperty(replacement, assignments);
      nodesById[replacement.id] = replacement;
    }
    clone.main_component_id = overriddenSymbolId;
    clone.childIds = (rawChildIds.get(overriddenSymbol.id) ?? []).flatMap((childId) => overrideIds.get(childId) ? [overrideIds.get(childId)!] : []);
    clone.resolvedChildIds = [...clone.childIds];
  }
}

function symbolOverrides(change: Record<string, unknown> | undefined): Map<string, Record<string, unknown>> {
  const entries = record(change?.symbolData)?.symbolOverrides;
  const values = Array.isArray(entries) ? entries : [];
  return new Map(values.flatMap((value) => {
    const override = record(value);
    const path = record(override?.guidPath)?.guids;
    if (!Array.isArray(path) || !path.length) return [];
    const leaf = path[path.length - 1];
    const nodeId = guidId(leaf);
    return nodeId && override ? [[nodeId, override] as const] : [];
  }));
}

function applySymbolOverride(node: AgentNode, override: Record<string, unknown> | undefined): void {
  if (!override) return;
  const textData = record(override.textData);
  if (typeof textData?.characters === 'string') {
    node.text = textData.characters;
    delete node.textSegments;
  }
  if (typeof override.visible === 'boolean') node.visible = override.visible;
  if (typeof override.name === 'string') node.name = override.name;
}

function normalizeNode(change: Record<string, unknown>, zIndex: number, assetPaths: Readonly<Record<string, string>> | undefined, vectorPaths: Readonly<Record<number, string>> | undefined, vectorSvgPaths: Readonly<Record<number, string>> | undefined, vectorNames: Readonly<Record<number, string>> | undefined): AgentNode {
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
    layout: pick(change, layoutKeys), fills: change.fillPaints, strokes: change.strokePaints,
    ...(typeof change.strokeWeight === 'number' ? { strokeWeight: change.strokeWeight } : {}),
    ...(typeof change.strokeCap === 'string' ? { strokeCap: change.strokeCap } : {}),
    ...(typeof change.strokeJoin === 'string' ? { strokeJoin: change.strokeJoin } : {}),
    effects: change.effects, typography, ...(styles ? { styleRefs: styles } : {}), ...(bindings ? { variableBindings: bindings } : {}), assetRefs: assetReferences(change.fillPaints, assetPaths), ...(vectorReference(change.vectorData, vectorPaths, vectorSvgPaths, vectorNames) ? { vectorRef: vectorReference(change.vectorData, vectorPaths, vectorSvgPaths, vectorNames) } : {}), ...(componentPropRefs(change) ? { componentPropRefs: componentPropRefs(change) } : {})
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
function vectorReference(value: unknown, vectorPaths: Readonly<Record<number, string>> | undefined, vectorSvgPaths: Readonly<Record<number, string>> | undefined, vectorNames: Readonly<Record<number, string>> | undefined): VectorReference | undefined {
  const data = record(value);
  const blobId = data?.vectorNetworkBlob;
  if (typeof blobId !== 'number') return undefined;
  const path = vectorPaths?.[blobId];
  const normalizedSize = record(data?.normalizedSize);
  const size = normalizedSize && typeof normalizedSize.x === 'number' && typeof normalizedSize.y === 'number' && normalizedSize.x > 0 && normalizedSize.y > 0 ? { x: normalizedSize.x, y: normalizedSize.y } : undefined;
  return path ? { blobId, path, format: 'kiwi-vector-network', compression: 'gzip', ...(size ? { normalizedSize: size } : {}), ...(vectorSvgPaths?.[blobId] ? { svgPath: vectorSvgPaths[blobId] } : {}), ...(vectorNames?.[blobId] ? { name: vectorNames[blobId] } : {}) } : undefined;
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
