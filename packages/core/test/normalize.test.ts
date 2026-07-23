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
    const normalized = normalizeDocument([{ guid: { sessionID: 2, localID: 5 }, vectorData: { vectorNetworkBlob: 7 } }], { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' }, vectorSvgPaths: { 7: 'assets/vectors/vector-network-7.svg' } });
    expect(normalized.nodesById['2:5']!.vectorRef).toEqual({ blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network', compression: 'gzip', svgPath: 'assets/vectors/vector-network-7.svg' });
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

  test('lists maximal vector groups in a packed node context', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 7, localID: 1 }, type: 'FRAME', size: { x: 100, y: 50 } },
      { guid: { sessionID: 7, localID: 2 }, type: 'FRAME', parentIndex: 0, name: 'Artwork', size: { x: 20, y: 10 } },
      { guid: { sessionID: 7, localID: 3 }, type: 'VECTOR', parentIndex: 1, size: { x: 20, y: 10 }, vectorData: { vectorNetworkBlob: 9 } },
      { guid: { sessionID: 7, localID: 4 }, type: 'TEXT', parentIndex: 0, textData: { characters: 'Caption' } }
    ], { vectorPaths: { 9: 'assets/vectors/vector-network-9.bin.gz' }, vectorSvgPaths: { 9: 'assets/vectors/vector-network-9.svg' } });

    expect(buildNodeContext(normalized, normalized.nodesById['7:1']!)).toMatchObject({
      vectorGroups: [{ nodeId: '7:2', name: 'Artwork', bounds: { x: 20, y: 10 }, vectorCount: 1 }]
    });
  });

  test('does not list a group whose vector SVG fragments are unavailable', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 8, localID: 1 }, type: 'FRAME', size: { x: 20, y: 10 } },
      { guid: { sessionID: 8, localID: 2 }, type: 'VECTOR', parentIndex: 0, size: { x: 20, y: 10 }, vectorData: { vectorNetworkBlob: 1 } }
    ], { vectorPaths: { 1: 'assets/vectors/vector-network-1.bin.gz' } });

    expect(buildNodeContext(normalized, normalized.nodesById['8:1']!).vectorGroups).toEqual([]);
  });

  test('retains Figma-computed text layout and visibility fields', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 5, localID: 1 }, type: 'TEXT', visible: false, opacity: 0.6, textData: { characters: 'Measured' }, derivedTextData: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }], glyphs: [{ commandsBlob: 99 }] } }]);
    expect(normalized.nodesById['5:1']).toMatchObject({ visible: false, opacity: 0.6, textLayout: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }] } });
    expect(normalized.nodesById['5:1']!.textLayout).not.toHaveProperty('glyphs');
  });

  test('retains mask and frame clipping flags for SVG composition', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 6, localID: 1 }, type: 'FRAME', mask: true, frameMaskDisabled: false }]);
    expect(normalized.nodesById['6:1']).toMatchObject({ mask: true, frameMaskDisabled: false });
  });
});
