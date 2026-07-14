import type { AgentDocument, AgentNode, AssetReference, VectorReference } from '../normalize/document.js';

export interface NodeContext {
  node: AgentNode;
  ancestors: Array<Pick<AgentNode, 'id' | 'name' | 'type'>>;
  nodes: AgentNode[];
  text: Array<Pick<AgentNode, 'id' | 'name' | 'text' | 'typography'>>;
  assets: AssetReference[];
  vectors: VectorReference[];
  nodeIds: string[];
}

/** Builds deterministic, complete local context for a node and all descendants. */
export function buildNodeContext(document: AgentDocument, node: AgentNode): NodeContext {
  const ancestors: Array<Pick<AgentNode, 'id' | 'name' | 'type'>> = [];
  let parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  while (parent) { ancestors.unshift({ id: parent.id, name: parent.name, type: parent.type }); parent = parent.parentId ? document.nodesById[parent.parentId] : undefined; }

  const nodes: AgentNode[] = [];
  const visit = (current: AgentNode) => { nodes.push(current); for (const childId of current.childIds) { const child = document.nodesById[childId]; if (child) visit(child); } };
  visit(node);
  const assets = unique(nodes.flatMap((item) => item.assetRefs), (item) => item.path);
  const vectors = unique(nodes.flatMap((item) => item.vectorRef ? [item.vectorRef] : []), (item) => item.path);
  const text = nodes.filter((item) => item.text !== undefined).map(({ id, name, text: value, typography }) => ({ id, name, text: value!, typography }));
  return { node, ancestors, nodes, text, assets, vectors, nodeIds: nodes.map((item) => item.id) };
}
function unique<T>(items: readonly T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
