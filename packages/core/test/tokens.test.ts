import { expect, test } from 'vitest';
import { extractTokens } from '../src/tokens/extract.js';

test('deduplicates color, typography, and effect tokens with node references', () => {
  const tokens = extractTokens({ contractVersion: '1', rootIds: ['1:1'], nodesById: {
    '1:1': { id: '1:1', name: 'one', type: 'RECTANGLE', childIds: [], zIndex: 0, assetRefs: [], fills: [{ type: 'SOLID', color: { r: 1 } }], typography: { fontSize: 16, fontName: { family: 'Inter', style: 'Bold', postscript: 'Inter-Bold' } }, textLayout: { fontMetaData: [{ fontWeight: 700 }] }, effects: [{ type: 'DROP_SHADOW' }] },
    '1:2': { id: '1:2', name: 'two', type: 'RECTANGLE', childIds: [], zIndex: 1, assetRefs: [], fills: [{ type: 'SOLID', color: { r: 1 } }], typography: { fontSize: 16, fontName: { family: 'Inter', style: 'Bold', postscript: 'Inter-Bold' } }, textLayout: { fontMetaData: [{ fontWeight: 700 }] }, effects: [{ type: 'DROP_SHADOW' }] }
  } });
  expect(tokens.colors[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.typography[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.effects[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.fonts).toMatchObject([{ family: 'Inter', style: 'Bold', postscript: 'Inter-Bold', weights: [700], nodeIds: ['1:1', '1:2'] }]);
});
