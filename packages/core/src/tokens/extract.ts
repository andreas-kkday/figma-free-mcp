import { createHash } from 'node:crypto';
import type { AgentDocument, AgentNode } from '../normalize/document.js';

export interface StyleToken { id: string; value: unknown; nodeIds: string[]; }
export interface FontRequirement { id: string; family: string; style?: string; postscript?: string; weights: number[]; nodeIds: string[]; }
export interface ExtractedTokens { colors: StyleToken[]; typography: StyleToken[]; effects: StyleToken[]; fonts: FontRequirement[]; }

export function extractTokens(document: AgentDocument): ExtractedTokens {
  return { colors: collect(document, 'color', (node) => ({ fills: node.fills, strokes: node.strokes })), typography: collect(document, 'typography', (node) => node.typography), effects: collect(document, 'effect', (node) => node.effects), fonts: collectFonts(document) };
}
function collectFonts(document: AgentDocument): FontRequirement[] {
  const requirements = new Map<string, FontRequirement>();
  for (const node of Object.values(document.nodesById)) {
    const name = node.typography?.fontName;
    if (!name || typeof name !== 'object' || Array.isArray(name)) continue;
    const font = name as Record<string, unknown>; const family = typeof font.family === 'string' ? font.family : undefined;
    if (!family) continue;
    const style = typeof font.style === 'string' ? font.style : undefined; const postscript = typeof font.postscript === 'string' ? font.postscript : undefined;
    const id = `font_${createHash('sha256').update(`${family}\0${style ?? ''}\0${postscript ?? ''}`).digest('hex').slice(0, 12)}`;
    const weight = fontWeight(node); const found = requirements.get(id);
    if (found) { found.nodeIds.push(node.id); if (weight !== undefined && !found.weights.includes(weight)) found.weights.push(weight); }
    else requirements.set(id, { id, family, ...(style ? { style } : {}), ...(postscript ? { postscript } : {}), weights: weight === undefined ? [] : [weight], nodeIds: [node.id] });
  }
  return [...requirements.values()].map((font) => ({ ...font, weights: font.weights.sort((a, b) => a - b), nodeIds: font.nodeIds.sort() })).sort((a, b) => a.id.localeCompare(b.id));
}
function fontWeight(node: AgentDocument['nodesById'][string]): number | undefined { const metadata = node.textLayout?.fontMetaData; if (!Array.isArray(metadata)) return undefined; const value = (metadata[0] as Record<string, unknown> | undefined)?.fontWeight; return typeof value === 'number' ? value : undefined; }
function collect(document: AgentDocument, prefix: string, select: (node: AgentNode) => unknown): StyleToken[] {
  const tokens = new Map<string, StyleToken>();
  for (const node of Object.values(document.nodesById)) {
    const value = select(node); if (!meaningful(value)) continue;
    const id = `${prefix}_${createHash('sha256').update(stable(value)).digest('hex').slice(0, 12)}`;
    const token = tokens.get(id); if (token) token.nodeIds.push(node.id); else tokens.set(id, { id, value, nodeIds: [node.id] });
  }
  return [...tokens.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function meaningful(value: unknown): boolean { return Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === 'object' && Object.keys(value).length > 0); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`; return JSON.stringify(value); }
