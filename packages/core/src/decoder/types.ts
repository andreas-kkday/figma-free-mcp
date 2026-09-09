export interface DecodedFig {
  readonly decoderVersion: string;
  readonly canvasVersion: number;
  /** Decompressed binary Kiwi schema extracted from the first canvas chunk. */
  readonly schemaBytes: Uint8Array;
  readonly document: Record<string, unknown>;
  readonly nodeChanges: readonly Record<string, unknown>[];
  readonly blobs: readonly unknown[];
}
