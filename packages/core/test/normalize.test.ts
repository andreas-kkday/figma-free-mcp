import { describe, expect, test } from 'vitest';
import { hashToHex, normalizeDocument, resolveNodeReference } from '../src/normalize/document.js';
import { buildNodeContext } from '../src/context/node-context.js';

const document = normalizeDocument([
  { guid: { sessionID: 1, localID: 1 }, type: 'DOCUMENT', name: 'Document' },
  { guid: { sessionID: 1, localID: 2 }, type: 'FRAME', name: 'Hero', parentIndex: 0, size: { x: 100, y: 50 } },
  { guid: { sessionID: 1, localID: 3 }, type: 'TEXT', name: 'Title', parentIndex: 1, textData: { characters: 'Hello' } }
]);

describe('normalized document', () => {
  test('builds stable IDs, hierarchy, and text context', () => {
    expect(document.nodesById['1:2']).toMatchObject({ id: '1:2', type: 'FRAME', childIds: ['1:3'] });
    expect(document.nodesById['1:3']).toMatchObject({ text: 'Hello', parentId: '1:2' });
  });

  test.each(['1:3', '1-3', 'https://www.figma.com/design/file/name?node-id=1-3'])
  ('resolves %s', (reference) => expect(resolveNodeReference(document, reference).id).toBe('1:3'));

  test('rejects a Figma URL for another file key', () => {
    const keyed = normalizeDocument([], { originFileKey: 'local-file' });
    expect(() => resolveNodeReference(keyed, 'https://www.figma.com/design/other-file/name?node-id=1-3')).toThrow(/bundle is for local-file/);
  });

  test('links an image fill to its extracted asset path', () => {
    const hash = Uint8Array.from({ length: 20 }, (_value, index) => index);
    const normalized = normalizeDocument([{ guid: { sessionID: 2, localID: 4 }, fillPaints: [{ type: 'IMAGE', image: { hash } }] }], { assetPaths: { [hashToHex(hash)!]: 'assets/images/example.png' } });
    expect(normalized.nodesById['2:4']!.assetRefs).toEqual([{ hash: hashToHex(hash), path: 'assets/images/example.png', kind: 'image-fill' }]);
  });

  test('preserves a vector-network blob reference', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 2, localID: 5 }, vectorData: { vectorNetworkBlob: 7 } }], { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' } });
    expect(normalized.nodesById['2:5']!.vectorRef).toEqual({ blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network', compression: 'gzip' });
  });

  test('collects every descendant text and asset for a frame context', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 4, localID: 1 }, type: 'FRAME' },
      { guid: { sessionID: 4, localID: 2 }, type: 'TEXT', parentIndex: 0, textData: { characters: 'Nested' } },
      { guid: { sessionID: 4, localID: 3 }, type: 'RECTANGLE', parentIndex: 1, fillPaints: [{ type: 'IMAGE', image: { hash: Uint8Array.from({ length: 20 }, () => 1) } }] }
    ], { assetPaths: { ['01'.repeat(20)]: 'assets/images/nested.png' } });
    const context = buildNodeContext(normalized, normalized.nodesById['4:1']!);
    expect(context.nodeIds).toEqual(['4:1', '4:2', '4:3']);
    expect(context.text).toEqual([expect.objectContaining({ id: '4:2', text: 'Nested' })]);
    expect(context.assets).toEqual([{ hash: '01'.repeat(20), path: 'assets/images/nested.png', kind: 'image-fill' }]);
  });

  test('retains Figma-computed text layout and visibility fields', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 5, localID: 1 }, type: 'TEXT', visible: false, opacity: 0.6, textData: { characters: 'Measured' }, derivedTextData: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }], glyphs: [{ commandsBlob: 99 }] } }]);
    expect(normalized.nodesById['5:1']).toMatchObject({ visible: false, opacity: 0.6, textLayout: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }] } });
    expect(normalized.nodesById['5:1']!.textLayout).not.toHaveProperty('glyphs');
  });
});
