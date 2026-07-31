import { describe, expect, it, vi } from "vitest";

import { pointFrom, type LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawRectangleElement,
} from "@excalidraw/element/types";

import {
  FREEDRAW_PREFIX,
  FREEDRAW_SCALE,
  parseElements,
  parseFreeDrawElement,
  stringifyElements,
  stringifyFreeDrawElement,
} from "../data/elementSerialization";

const makeFreeDrawElement = (
  overrides: Partial<ExcalidrawFreeDrawElement> = {},
): ExcalidrawFreeDrawElement =>
  ({
    type: "freedraw",
    id: "freedraw-1",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 42,
    version: 1,
    versionNonce: 123456,
    index: "a1",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(1.23, 4.56),
      pointFrom<LocalPoint>(-10, 20),
    ],
    pressures: [0.1, 0.5, 1],
    simulatePressure: false,
    strokeOptions: { variability: "variable", streamline: 0.4 },
    ...overrides,
  } as ExcalidrawFreeDrawElement);

const makeRectangleElement = (
  overrides: Partial<ExcalidrawRectangleElement> = {},
): ExcalidrawRectangleElement =>
  ({
    type: "rectangle",
    id: "rectangle-1",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 42,
    version: 1,
    versionNonce: 123456,
    index: "a1",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
    ...overrides,
  } as ExcalidrawRectangleElement);

const quantize = (value: number, scale: number = FREEDRAW_SCALE) =>
  Math.round(value * scale) / scale;

describe("stringifyFreeDrawElement / parseFreeDrawElement", () => {
  it("round-trips an element, preserving base fields exactly and quantizing points/pressures", () => {
    const element = makeFreeDrawElement();

    const restored = parseFreeDrawElement(stringifyFreeDrawElement(element));

    const { points, pressures, ...expectedBase } = element;
    const {
      points: restoredPoints,
      pressures: restoredPressures,
      ...restoredBase
    } = restored;

    expect(restoredBase).toEqual(expectedBase);
    expect(restoredPoints).toEqual(
      element.points.map(([x, y]) => [quantize(x), quantize(y)]),
    );
    expect(restoredPressures).toEqual(
      element.pressures.map((pressure) => quantize(pressure)),
    );
  });

  it("produces a printable string with a freedraw: prefix and a length-prefixed header", () => {
    const serialized = stringifyFreeDrawElement(makeFreeDrawElement());

    expect(serialized.startsWith(FREEDRAW_PREFIX)).toBe(true);
    // fully printable - no control characters (safe for localStorage/query strings)
    expect([...serialized].some((c) => c.charCodeAt(0) < 0x20)).toBe(false);

    const header = serialized
      .slice(FREEDRAW_PREFIX.length)
      .match(/^(\d+),(\d+),(\d+),(\d+),/);
    expect(header).not.toBeNull();
    const [, scale, baseJSONLength, pointsLength, pressuresLength] = header!;
    expect(Number(scale)).toBe(FREEDRAW_SCALE);

    const headerLength = header![0].length;
    const baseJSON = serialized.slice(
      FREEDRAW_PREFIX.length + headerLength,
      FREEDRAW_PREFIX.length + headerLength + Number(baseJSONLength),
    );
    expect(JSON.parse(baseJSON)).toMatchObject({ type: "freedraw" });

    // string length = prefix + header + all sections
    expect(serialized.length).toBe(
      FREEDRAW_PREFIX.length +
        headerLength +
        Number(baseJSONLength) +
        Number(pointsLength) +
        Number(pressuresLength),
    );
  });

  it("handles elements with empty points", () => {
    const element = makeFreeDrawElement({ points: [] });

    const restored = parseFreeDrawElement(stringifyFreeDrawElement(element));

    expect(restored.points).toEqual([]);
    expect(restored.pressures).toEqual([0.1, 0.5, 1]);
  });

  it("omits the pressures section when pressures are empty (simulated pressure)", () => {
    const element = makeFreeDrawElement({
      pressures: [],
      simulatePressure: true,
    });

    const serialized = stringifyFreeDrawElement(element);
    const header = serialized
      .slice(FREEDRAW_PREFIX.length)
      .match(/^(\d+),(\d+),(\d+),(\d+),/);
    expect(header![4]).toBe("0");

    const restored = parseFreeDrawElement(serialized);
    expect(restored.pressures).toEqual([]);
    expect(restored.simulatePressure).toBe(true);
  });

  it("round-trips negative coordinates and large deltas (multi-byte varints)", () => {
    const element = makeFreeDrawElement({
      points: [
        pointFrom<LocalPoint>(-1234.56, -0.01),
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(5000, -3000),
      ],
    });

    const restored = parseFreeDrawElement(stringifyFreeDrawElement(element));

    expect(restored.points).toEqual(
      element.points.map(([x, y]) => [quantize(x), quantize(y)]),
    );
  });

  it("supports a custom quantization scale and decodes it from the header", () => {
    const element = makeFreeDrawElement();

    const serialized = stringifyFreeDrawElement(element, 50);
    expect(serialized.startsWith(`${FREEDRAW_PREFIX}50,`)).toBe(true);

    const restored = parseFreeDrawElement(serialized);
    expect(restored.points).toEqual(
      element.points.map(([x, y]) => [quantize(x, 50), quantize(y, 50)]),
    );
  });

  it("throws on strings without the freedraw prefix", () => {
    expect(() => parseFreeDrawElement("rectangle:whatever")).toThrow();
    expect(() => parseFreeDrawElement("garbage")).toThrow();
  });
});

describe("stringifyElements / parseElements", () => {
  it("serializes freedraw elements as strings and rehydrates them on parse", () => {
    const freedraw = makeFreeDrawElement();

    const raw = stringifyElements([freedraw]);
    // the stored document contains an opaque string for the freedraw element
    expect(typeof JSON.parse(raw)[0]).toBe("string");

    const parsed = parseElements<ExcalidrawElement[]>(raw);
    expect(parsed).toEqual([
      parseFreeDrawElement(stringifyFreeDrawElement(freedraw)),
    ]);
  });

  it("passes legacy plain-object elements (incl. old-format freedraw) through untouched", () => {
    const freedraw = makeFreeDrawElement();
    const rectangle = makeRectangleElement();
    const legacyFreedraw = makeFreeDrawElement({ id: "legacy-freedraw" });

    // simulate old-format data: freedraw stored as a plain object, not a string
    const raw = JSON.stringify([
      stringifyFreeDrawElement(freedraw),
      rectangle,
      legacyFreedraw,
    ]);

    const parsed = parseElements<ExcalidrawElement[]>(raw);

    expect(parsed.length).toBe(3);
    expect(parsed[0]).toEqual(
      parseFreeDrawElement(stringifyFreeDrawElement(freedraw)),
    );
    expect(parsed[1]).toEqual(rectangle);
    expect(parsed[2]).toEqual(legacyFreedraw);
  });

  it("skips corrupt freedraw entries and keeps the rest of the scene", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rectangle = makeRectangleElement();
      const raw = JSON.stringify([
        rectangle,
        "freedraw:this-is-not-valid",
        "freedraw:100,3,0,0,{x}",
      ]);

      const parsed = parseElements<ExcalidrawElement[]>(raw);

      expect(parsed).toEqual([rectangle]);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("passes through strings that don't match any serializer", () => {
    expect(
      parseElements<unknown[]>(JSON.stringify(["unknown-string", 42])),
    ).toEqual(["unknown-string", 42]);
  });

  it("returns non-array JSON as-is", () => {
    expect(parseElements("null")).toBeNull();
    expect(parseElements("{}")).toEqual({});
  });
});
