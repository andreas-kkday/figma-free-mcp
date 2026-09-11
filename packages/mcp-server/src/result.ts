import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const defaultResultLimitBytes = 256 * 1024;

export interface ExternalizedResult {
  resultFile: string;
  bytes: number;
  thresholdBytes: number;
}

/** Return a normal MCP text response, or spill an oversized JSON result to /tmp. */
export function resultText(toolName: string, value: unknown): Promise<CallToolResult> {
  return resultBundle(toolName, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
}

/** Keep the complete MCP result intact unless its JSON representation is too large. */
export async function resultBundle(toolName: string, response: CallToolResult): Promise<CallToolResult> {
  const serialized = JSON.stringify(response, null, 2);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const thresholdBytes = resultLimitBytes();
  if (bytes <= thresholdBytes) return response;

  const resultFile = await writeResultFile(toolName, serialized);
  const externalized: ExternalizedResult = { resultFile, bytes, thresholdBytes };
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'Result exceeded the configured inline size limit; the complete JSON result was written to this file.',
        ...externalized
      }, null, 2)
    }]
  };
}

export function resultLimitBytes(environment: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(environment.FIGMA_MCP_RESULT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : defaultResultLimitBytes;
}

async function writeResultFile(toolName: string, text: string): Promise<string> {
  const directory = join(tmpdir(), `.figma-mcp-${process.pid}`);
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = randomBytes(4).toString('hex').slice(0, 5);
    const path = join(directory, `${toolName}-${suffix}`);
    try {
      await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
      return path;
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not allocate a unique temporary result file.');
}
