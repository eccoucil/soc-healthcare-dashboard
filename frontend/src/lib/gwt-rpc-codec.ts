/**
 * GWT-RPC wire protocol codec.
 *
 * GWT-RPC (Google Web Toolkit - Remote Procedure Call) uses a pipe-delimited
 * serialization format. Requests are built as:
 *   version|flags|stringCount|string1|string2|...|index1|index2|...|
 *
 * Responses begin with "//OK" followed by a JavaScript array literal.
 * Large responses may use ".concat()" to split the string.
 */

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export interface GwtRpcServiceConfig {
  /** Fully-qualified Java interface name, e.g. "com.arcsight.product.core.service.v1.client.gwt.api.LoginService" */
  serviceInterface: string;
  /** Method name to invoke, e.g. "login" */
  method: string;
  /** GWT module base URL, e.g. "https://host:48443/www/ui-phoenix/com.arcsight.phoenix.PhoenixLauncher/" */
  moduleBaseUrl: string;
  /** Strong name (permutation hash), e.g. "4D0A049F53B67145A7E76738739AE51D" */
  strongName: string;
}

/**
 * Typed parameter for the GWT-RPC encoder.
 *
 * GWT-RPC encodes each top-level parameter with a type descriptor (string-table ref)
 * followed by the serialized value. Complex objects serialize their fields inline.
 */
export type GwtRpcParam =
  | { kind: "string"; value: string | null }
  | {
      kind: "object";
      typeDescriptor: string;
      fields: GwtRpcParam[];
    }
  | { kind: "enum"; typeDescriptor: string; ordinal: number }
  | { kind: "int"; value: number };

/**
 * Infer the GWT-RPC type descriptor for a top-level parameter.
 * - string/null → "java.lang.String/2004016611"
 * - object/enum → their own typeDescriptor
 * - int → "I" (primitive int, rarely used at top level)
 */
function getTypeDescriptor(param: GwtRpcParam): string {
  switch (param.kind) {
    case "string":
      return "java.lang.String/2004016611";
    case "object":
      return param.typeDescriptor;
    case "enum":
      return param.typeDescriptor;
    case "int":
      return "I";
  }
}

/**
 * Build a GWT-RPC request body string.
 *
 * Wire format:
 *   version | flags | stringCount | strings... |
 *   moduleIdx | strongIdx | serviceIdx | methodIdx |
 *   paramCount | typeIdx1 | typeIdx2 | ... |
 *   value1 | value2 | ... |
 *
 * @param config  Service metadata
 * @param params  Typed parameters in Java method parameter order
 * @returns Pipe-delimited GWT-RPC request body
 */
export function buildGwtRpcRequest(
  config: GwtRpcServiceConfig,
  params: GwtRpcParam[]
): string {
  const version = 7;
  const flags = 0;

  // String table with 1-based indexing and deduplication
  const stringTable: string[] = [];
  const stringIndex = new Map<string, number>();

  function addString(s: string): number {
    const existing = stringIndex.get(s);
    if (existing !== undefined) return existing;
    stringTable.push(s);
    const idx = stringTable.length; // 1-based
    stringIndex.set(s, idx);
    return idx;
  }

  // Serialize a single param's VALUE into the payload array.
  // Returns an array of numbers (string-table refs, ordinals, or raw ints).
  function serializeValue(param: GwtRpcParam): number[] {
    switch (param.kind) {
      case "string":
        // null → 0, otherwise string-table ref
        return [param.value === null ? 0 : addString(param.value)];
      case "int":
        return [param.value];
      case "enum":
        // type marker index, then ordinal, then null terminator
        return [addString(param.typeDescriptor), param.ordinal, 0];
      case "object": {
        // type marker index, then each field serialized inline
        const parts: number[] = [addString(param.typeDescriptor)];
        for (const field of param.fields) {
          parts.push(...serializeValue(field));
        }
        return parts;
      }
    }
  }

  // Phase 1: Add all strings to the table by doing a dry-run serialization.
  // We also add type descriptors and service metadata strings.
  // (addString is idempotent, so calling it again in Phase 2 just returns cached indices.)

  // Service metadata strings
  addString(config.moduleBaseUrl);
  addString(config.strongName);
  addString(config.serviceInterface);
  addString(config.method);

  // Pre-populate type descriptor strings + value strings
  for (const param of params) {
    addString(getTypeDescriptor(param));
    serializeValue(param); // side-effect: adds strings to table
  }

  // Phase 2: Build the actual payload with final indices
  const moduleIdx = addString(config.moduleBaseUrl);
  const strongIdx = addString(config.strongName);
  const serviceIdx = addString(config.serviceInterface);
  const methodIdx = addString(config.method);

  // Type descriptor indices (one per top-level param)
  const typeIndices = params.map((p) => addString(getTypeDescriptor(p)));

  // Serialized values (flattened)
  const valuePayload: number[] = [];
  for (const param of params) {
    valuePayload.push(...serializeValue(param));
  }

  const parts: (string | number)[] = [
    version,
    flags,
    stringTable.length,
    ...stringTable,
    moduleIdx,
    strongIdx,
    serviceIdx,
    methodIdx,
    params.length,
    ...typeIndices,
    ...valuePayload,
  ];

  return parts.join("|") + "|";
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export interface GwtRpcDecodedResponse {
  ok: boolean;
  values: unknown[];
  stringTable: string[];
}

/**
 * Decode a GWT-RPC response body.
 *
 * Handles:
 * - "//OK[...]" prefix stripping
 * - ".concat()" splitting for large responses
 * - JavaScript array parsing
 *
 * @returns Parsed payload values and string table
 */
export function decodeGwtRpcResponse(raw: string): GwtRpcDecodedResponse {
  const trimmed = raw.trim();

  // Check for error response
  if (trimmed.startsWith("//EX")) {
    const body = trimmed.slice(4);
    throw new Error(`GWT-RPC error response: ${body.slice(0, 500)}`);
  }

  if (!trimmed.startsWith("//OK")) {
    throw new Error(
      `Unexpected GWT-RPC response prefix: ${trimmed.slice(0, 50)}`
    );
  }

  // Strip //OK prefix
  let arrayStr = trimmed.slice(4);

  // Handle .concat() splitting — GWT splits large responses like:
  //   [part1].concat([part2]).concat([part3])
  // We need to merge them into a single array.
  if (arrayStr.includes(".concat(")) {
    const parts: unknown[] = [];
    // Split on .concat( and parse each fragment
    const fragments = arrayStr.split(/\.concat\(/);
    for (const frag of fragments) {
      // Remove trailing ) if present from concat wrapper
      const cleaned = frag.replace(/\)\s*$/, "").trim();
      if (!cleaned) continue;
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          parts.push(...parsed);
        }
      } catch {
        // Some fragments may have complex nesting — try eval-safe approach
        // by wrapping in array brackets if needed
        try {
          const wrapped = cleaned.startsWith("[") ? cleaned : `[${cleaned}]`;
          const parsed = JSON.parse(wrapped);
          if (Array.isArray(parsed)) {
            parts.push(...parsed);
          }
        } catch {
          // Skip unparseable fragments
          console.warn(
            "[gwt-rpc] Skipping unparseable fragment:",
            cleaned.slice(0, 100)
          );
        }
      }
    }
    return extractStringTable(parts);
  }

  // Simple case: single array
  const parsed = JSON.parse(arrayStr);
  if (!Array.isArray(parsed)) {
    throw new Error("GWT-RPC response is not an array");
  }

  return extractStringTable(parsed);
}

/**
 * Extract the string table from parsed GWT-RPC values.
 *
 * In GWT-RPC responses, the string table is typically the last element
 * and is itself a nested array of strings.
 */
function extractStringTable(values: unknown[]): GwtRpcDecodedResponse {
  // Find the string table — it's typically the last element that is an array of strings
  let stringTable: string[] = [];
  let payloadValues = values;

  if (values.length > 0) {
    const last = values[values.length - 1];
    if (
      Array.isArray(last) &&
      (last.length === 0 || typeof last[0] === "string")
    ) {
      stringTable = last as string[];
      payloadValues = values.slice(0, -1);
    }
  }

  return {
    ok: true,
    values: payloadValues,
    stringTable,
  };
}

// ---------------------------------------------------------------------------
// Reader — sequential value extraction from GWT-RPC payload
// ---------------------------------------------------------------------------

/**
 * Reads values sequentially from a decoded GWT-RPC payload.
 *
 * GWT-RPC encodes objects as a flat sequence of values. String fields are
 * stored as 1-based indices into the string table (0 = null). Numeric fields
 * are stored as raw numbers. This reader provides typed accessors that
 * advance a cursor through the payload.
 */
export class GwtRpcReader {
  private cursor = 0;

  constructor(
    private readonly values: unknown[],
    private readonly stringTable: string[]
  ) {}

  /** Current position in the payload */
  get position(): number {
    return this.cursor;
  }

  /** Whether there are more values to read */
  get hasMore(): boolean {
    return this.cursor < this.values.length;
  }

  /** Read a raw value and advance the cursor */
  readRaw(): unknown {
    if (this.cursor >= this.values.length) {
      throw new Error(
        `GwtRpcReader: read past end of values at position ${this.cursor}`
      );
    }
    return this.values[this.cursor++];
  }

  /** Read a string via 1-based string table index. Returns "" for index 0 (null). */
  readString(): string {
    const val = this.readRaw();
    if (typeof val === "string") return val;
    const idx = Number(val);
    if (idx === 0 || isNaN(idx)) return "";
    // String table is 0-indexed but references are 1-based
    return this.stringTable[idx - 1] ?? "";
  }

  /** Read a nullable string. Returns undefined for index 0 (null). */
  readNullableString(): string | undefined {
    const val = this.readRaw();
    if (typeof val === "string") return val;
    const idx = Number(val);
    if (idx === 0 || isNaN(idx)) return undefined;
    return this.stringTable[idx - 1];
  }

  /** Read an integer value */
  readInt(): number {
    const val = this.readRaw();
    return typeof val === "number" ? val : parseInt(String(val), 10);
  }

  /** Read a float value */
  readFloat(): number {
    const val = this.readRaw();
    return typeof val === "number" ? val : parseFloat(String(val));
  }

  /** Read a boolean (0 = false, nonzero = true) */
  readBoolean(): boolean {
    return this.readInt() !== 0;
  }

  /** Skip n values */
  skip(n: number): void {
    this.cursor += n;
  }

  /** Peek at the next value without advancing */
  peek(): unknown {
    return this.values[this.cursor];
  }

  /** Reset cursor to a specific position */
  seek(position: number): void {
    this.cursor = position;
  }

  /** Get total number of values */
  get length(): number {
    return this.values.length;
  }
}
