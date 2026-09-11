import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, test } from 'vitest';
import { resultLimitBytes, resultText } from '../src/result.js';

test('keeps results inline below the configured byte limit', async () => {
  const result = await resultText('inspect_node', { value: 'small' });
  expect(JSON.parse(result.content[0].text)).toEqual({ value: 'small' });
});

test('writes oversized results to a per-process temporary file', async () => {
  const previousLimit = process.env.FIGMA_MCP_RESULT_MAX_BYTES;
  process.env.FIGMA_MCP_RESULT_MAX_BYTES = '1';
  try {
    const result = await resultText('get_frame_bundle', { value: 'x'.repeat(32) });
    const response = JSON.parse(result.content[0].text) as { resultFile: string; bytes: number; thresholdBytes: number };

    expect(response.resultFile).toContain(`/.figma-mcp-${process.pid}/get_frame_bundle-`);
    expect(basename(response.resultFile)).toMatch(/^get_frame_bundle-[a-f0-9]{5}$/);
    expect(response.bytes).toBeGreaterThan(response.thresholdBytes);
    expect(JSON.parse(await readFile(response.resultFile, 'utf8'))).toEqual({ content: [{ type: 'text', text: JSON.stringify({ value: 'x'.repeat(32) }, null, 2) }] });
    await rm(response.resultFile, { force: true });
  } finally {
    if (previousLimit === undefined) delete process.env.FIGMA_MCP_RESULT_MAX_BYTES;
    else process.env.FIGMA_MCP_RESULT_MAX_BYTES = previousLimit;
  }
});

test('uses FIGMA_MCP_RESULT_MAX_BYTES when it is a positive integer', () => {
  expect(resultLimitBytes({ FIGMA_MCP_RESULT_MAX_BYTES: '123' })).toBe(123);
  expect(resultLimitBytes({ FIGMA_MCP_RESULT_MAX_BYTES: '0' })).toBe(256 * 1024);
});
