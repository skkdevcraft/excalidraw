import { isFreeDrawElement } from "@excalidraw/element";

import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/element/types";

// -----------------------------------------------------------------------------
// Elements are serialized to the local store as a JSON array of elements.
//
// Specialized element types (e.g. freedraw, which carries large arrays of
// points/pressures) can opt into a custom, more compact representation via an
// `ElementSerializer`. Each such element is stored as an opaque string
// prefixed with a unique keyword (e.g. "freedraw:") which is used to identify
// the serializer when parsing. All other elements are stored as plain JSON.
// -----------------------------------------------------------------------------

export const FREEDRAW_PREFIX = "freedraw:";

/** Quantization scale for freedraw points/pressures (i.e. `1 / quantization unit`).
 * Defaults to `100`, quantizing coordinates to `0.01` units.
 * Tweak this to experiment with the size/precision trade-off. */
export const FREEDRAW_SCALE = 100;

type ElementSerializer = {
  /** keyword prefix identifying the serialized string form */
  prefix: string;
  /** whether a given element should be serialized with this serializer */
  matches: (element: ExcalidrawElement) => boolean;
  stringify: (element: ExcalidrawElement) => string;
  parse: (raw: string) => ExcalidrawElement;
};

export const stringifyElements = (
  elements: readonly ExcalidrawElement[],
): string =>
  JSON.stringify(
    elements.map((element) => {
      const serializer = serializers.find((s) => s.matches(element));
      return serializer ? serializer.stringify(element) : element;
    }),
  );

export const parseElements = <T = ExcalidrawElement[]>(raw: string): T => {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return parsed as T;
  }
  return parsed
    .map((entry) => {
      if (typeof entry !== "string") {
        return entry;
      }
      const serializer = serializers.find((s) => entry.startsWith(s.prefix));
      if (!serializer) {
        return entry;
      }
      try {
        return serializer.parse(entry);
      } catch (error) {
        // Skip the corrupt entry but keep the rest of the scene.
        console.error(
          `Failed to parse serialized element (${serializer.prefix}), skipping it.`,
          error,
        );
        return null;
      }
    })
    .filter((entry) => entry !== null) as T;
};

// -----------------------------------------------------------------------------
// Freedraw serialization
//
// Format:
//   "freedraw:" <scale> "," <lenBaseJSON> "," <lenPoints> "," <lenPressures> ","
//   <baseJSON> <points> <pressures>
//
// All sections are concatenated without separators and sliced by character
// length from the header, so no delimiter escaping is needed and the string is
// fully printable (safe for localStorage and query strings).
//
// - <scale> is the quantization scale (integer `1 / q`), self-describing so
//   stored data remains decodable even if the default scale changes.
// - <baseJSON> is the JSON.stringify'd element minus points/pressures.
// - <points>/<pressures> are quantized, delta-encoded, zigzag-encoded,
//   varint-encoded and base64url-encoded number streams.
// - <lenPressures> is 0 when the pressures section is absent (e.g. when
//   simulating pressure).
// -----------------------------------------------------------------------------

export const stringifyFreeDrawElement = (
  element: ExcalidrawFreeDrawElement,
  scale: number = FREEDRAW_SCALE,
): string => {
  const { points, pressures, ...baseFields } = element;

  const encodedPoints = encodeNumberStream(
    points.flatMap(([x, y]) => [x, y]),
    scale,
  );
  const encodedPressures =
    pressures.length > 0 ? encodeNumberStream([...pressures], scale) : "";

  const baseJSON = JSON.stringify(baseFields);

  return `${
    FREEDRAW_PREFIX +
    [
      scale,
      baseJSON.length,
      encodedPoints.length,
      encodedPressures.length,
    ].join(",")
  },${baseJSON}${encodedPoints}${encodedPressures}`;
};

export const parseFreeDrawElement = (
  raw: string,
): ExcalidrawFreeDrawElement => {
  if (!raw.startsWith(FREEDRAW_PREFIX)) {
    throw new Error("Invalid freedraw element serialization: missing prefix");
  }

  const rest = raw.slice(FREEDRAW_PREFIX.length);

  const header: number[] = [];
  let cursor = 0;
  for (let i = 0; i < 4; i++) {
    const comma = rest.indexOf(",", cursor);
    if (comma === -1) {
      throw new Error(
        "Invalid freedraw element serialization: truncated header",
      );
    }
    const value = Number(rest.slice(cursor, comma));
    if (!Number.isFinite(value)) {
      throw new Error(
        "Invalid freedraw element serialization: malformed header",
      );
    }
    header.push(value);
    cursor = comma + 1;
  }

  const [scale, baseJSONLength, pointsLength, pressuresLength] = header;

  const baseJSON = rest.slice(cursor, cursor + baseJSONLength);
  const pointsSection = rest.slice(
    cursor + baseJSONLength,
    cursor + baseJSONLength + pointsLength,
  );
  const pressuresSection = rest.slice(
    cursor + baseJSONLength + pointsLength,
    cursor + baseJSONLength + pointsLength + pressuresLength,
  );

  const base = JSON.parse(baseJSON) as Omit<
    ExcalidrawFreeDrawElement,
    "points" | "pressures"
  >;

  const scaledPoints = decodeNumberStream(pointsSection);
  const points: LocalPoint[] = [];
  for (let i = 0; i + 1 < scaledPoints.length; i += 2) {
    points.push(
      pointFrom<LocalPoint>(
        scaledPoints[i] / scale,
        scaledPoints[i + 1] / scale,
      ),
    );
  }

  const pressures = decodeNumberStream(pressuresSection).map(
    (value) => value / scale,
  );

  return { ...base, points, pressures };
};

const serializers: ElementSerializer[] = [
  {
    prefix: FREEDRAW_PREFIX,
    matches: isFreeDrawElement,
    stringify: (element) =>
      stringifyFreeDrawElement(element as ExcalidrawFreeDrawElement),
    parse: parseFreeDrawElement,
  },
];

// -----------------------------------------------------------------------------
// Number stream encoding helpers
// -----------------------------------------------------------------------------

const zigzagEncode = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1);

const zigzagDecode = (n: number): number =>
  n % 2 === 0 ? n / 2 : -(n + 1) / 2;

const pushVarint = (bytes: number[], value: number): void => {
  let v = value;
  while (v >= 0x80) {
    bytes.push(v % 0x80 | 0x80);
    v = Math.floor(v / 0x80);
  }
  bytes.push(v);
};

const readVarint = (bytes: Uint8Array, offset: { value: number }): number => {
  let result = 0;
  let shift = 0;
  while (offset.value < bytes.length) {
    const byte = bytes[offset.value++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }
  return result;
};

/** Quantize, delta-encode, zigzag-encode, varint-encode and base64url-encode
 * a stream of numbers. */
const encodeNumberStream = (values: number[], scale: number): string => {
  if (values.length === 0) {
    return "";
  }
  const scaled = values.map((value) => Math.round(value * scale));
  const bytes: number[] = [];
  let prev = scaled[0];
  pushVarint(bytes, zigzagEncode(prev));
  for (let i = 1; i < scaled.length; i++) {
    const delta = scaled[i] - prev;
    prev = scaled[i];
    pushVarint(bytes, zigzagEncode(delta));
  }
  return bytesToBase64Url(bytes);
};

/** Inverse of `encodeNumberStream`. Returns the quantized (scaled) integers. */
const decodeNumberStream = (encoded: string): number[] => {
  if (!encoded) {
    return [];
  }
  const bytes = base64UrlToBytes(encoded);
  const values: number[] = [];
  const offset = { value: 0 };
  let prev = 0;
  let first = true;
  while (offset.value < bytes.length) {
    const value = first
      ? zigzagDecode(readVarint(bytes, offset))
      : prev + zigzagDecode(readVarint(bytes, offset));
    first = false;
    prev = value;
    values.push(value);
  }
  return values;
};

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesToBase64Url = (bytes: number[]): string => {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += BASE64URL_ALPHABET[b0 >> 2];
    result += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) {
      result += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    }
    if (b2 !== undefined) {
      result += BASE64URL_ALPHABET[b2 & 0x3f];
    }
  }
  return result;
};

const base64UrlToBytes = (str: string): Uint8Array => {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const value = BASE64URL_ALPHABET.indexOf(str[i]);
    if (value === -1) {
      throw new Error(`Invalid base64url character: ${str[i]}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
};
