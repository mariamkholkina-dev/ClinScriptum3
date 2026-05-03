/**
 * DrawingML / VML extractor for shapes that overlay SoA tables.
 *
 * SoA tables in real protocols often mark cells via graphic objects rather
 * than text — a horizontal arrow over Day 1..Day 28 means "drug
 * administration on every visit", a bracket joining several visit columns
 * means "follow-up window covers these visits", a line connects two
 * visits with the same procedure. This module finds those drawings in
 * `word/document.xml` and returns their positions in EMU (English Metric
 * Units, 914400 per inch).
 *
 * EMU coordinates are absolute on the page for `<wp:anchor>` (floating)
 * and relative to the paragraph for `<wp:inline>` (inline). Mapping to
 * cells happens in `@clinscriptum/shared` after table geometry is known.
 *
 * Scope: OOXML DrawingML (modern Word). VML (`<v:shape>`,`<v:line>` in
 * `mc:AlternateContent`/`mc:Fallback`) is detected at the type level but
 * not extracted in detail — Word emits both for backward compat and the
 * DrawingML side already carries the geometry we need.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface DrawingPosition {
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}

export type DrawingType = "arrow" | "line" | "bracket" | "image" | "shape";

export interface Drawing {
  type: DrawingType;
  position: DrawingPosition;
  /**
   * For arrows and lines: which axis dominates. Computed from cx/cy ratio:
   * cx >= 2*cy → horizontal, cy >= 2*cx → vertical, otherwise undefined.
   */
  direction?: "horizontal" | "vertical";
  /**
   * Index of the paragraph that contains this drawing (for inline) or
   * anchors against (for floating). 0-based, matches mammoth's element
   * index used elsewhere in doc-parser.
   */
  paragraphIndex: number;
  /** OOXML preset name for shapes (e.g. `rightArrow`, `straightConnector1`). */
  prstGeom?: string;
}

const ARROW_PRESETS = new Set([
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "leftRightArrow",
  "upDownArrow",
  "stripedRightArrow",
  "notchedRightArrow",
  "bentArrow",
  "uturnArrow",
  "circularArrow",
  "rightArrowCallout",
  "leftArrowCallout",
  "upArrowCallout",
  "downArrowCallout",
  "leftRightArrowCallout",
  "upDownArrowCallout",
  "quadArrow",
  "quadArrowCallout",
]);

const LINE_PRESETS = new Set([
  "line",
  "straightConnector1",
  "bentConnector2",
  "bentConnector3",
  "bentConnector4",
  "bentConnector5",
  "curvedConnector2",
  "curvedConnector3",
  "curvedConnector4",
  "curvedConnector5",
]);

const BRACKET_PRESETS = new Set([
  "leftBracket",
  "rightBracket",
  "bracketPair",
  "leftBrace",
  "rightBrace",
  "bracePair",
]);

function classifyShape(prstGeom: string | undefined): DrawingType {
  if (!prstGeom) return "shape";
  if (ARROW_PRESETS.has(prstGeom)) return "arrow";
  if (LINE_PRESETS.has(prstGeom)) return "line";
  if (BRACKET_PRESETS.has(prstGeom)) return "bracket";
  return "shape";
}

function classifyDirection(
  position: DrawingPosition,
): "horizontal" | "vertical" | undefined {
  const { cxEmu, cyEmu } = position;
  if (cxEmu <= 0 || cyEmu <= 0) return undefined;
  if (cxEmu >= cyEmu * 2) return "horizontal";
  if (cyEmu >= cxEmu * 2) return "vertical";
  return undefined;
}

interface XmlNode {
  [key: string]: unknown;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function intAttr(node: XmlNode | undefined, attr: string): number {
  if (!node) return 0;
  const raw = node[attr];
  if (raw == null) return 0;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Walk the parsed `w:document` tree and collect every drawing node.
 * Returns drawings paired with the index of the enclosing `w:p` so
 * downstream code can resolve which table the drawing overlays.
 */
export function extractDrawingsFromDocumentXml(xmlText: string): Drawing[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    preserveOrder: false,
    allowBooleanAttributes: true,
    removeNSPrefix: true,
  });

  let parsed: XmlNode;
  try {
    parsed = parser.parse(xmlText) as XmlNode;
  } catch {
    return [];
  }

  const document = (parsed.document ?? parsed["w:document"]) as XmlNode | undefined;
  if (!document) return [];
  const body = (document.body ?? document["w:body"]) as XmlNode | undefined;
  if (!body) return [];

  const drawings: Drawing[] = [];
  let paragraphIndex = 0;

  const visit = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as XmlNode;

    for (const [key, value] of Object.entries(obj)) {
      if (key === "p") {
        // Each <w:p> is a paragraph. Drawings inside are attributed to it.
        for (const para of asArray(value)) {
          extractDrawingsFromParagraph(para as XmlNode, paragraphIndex, drawings);
          paragraphIndex++;
        }
      } else if (key === "tbl") {
        // Tables contain nested paragraphs — recurse so inner drawings
        // (e.g. a shape inside a cell) keep being indexed.
        for (const tbl of asArray(value)) visit(tbl);
      } else if (typeof value === "object" && value !== null) {
        visit(value);
      }
    }
  };

  visit(body);
  return drawings;
}

function extractDrawingsFromParagraph(
  paragraph: XmlNode,
  paragraphIndex: number,
  out: Drawing[],
): void {
  const collect = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as XmlNode;

    for (const [key, value] of Object.entries(obj)) {
      if (key === "drawing") {
        for (const drawing of asArray(value)) {
          const parsed = parseDrawingNode(drawing as XmlNode, paragraphIndex);
          if (parsed) out.push(parsed);
        }
      } else if (key === "AlternateContent") {
        // mc:AlternateContent has Choice (DrawingML) + Fallback (VML).
        // The Choice branch is the modern DrawingML — recurse into it.
        for (const ac of asArray(value)) {
          const choice = (ac as XmlNode).Choice;
          if (choice) collect(choice);
        }
      } else if (typeof value === "object" && value !== null) {
        collect(value);
      }
    }
  };

  collect(paragraph);
}

function parseDrawingNode(
  drawing: XmlNode,
  paragraphIndex: number,
): Drawing | null {
  // <w:drawing> contains either <wp:inline> or <wp:anchor>.
  const inline = drawing.inline as XmlNode | undefined;
  const anchor = drawing.anchor as XmlNode | undefined;
  const wrapper = inline ?? anchor;
  if (!wrapper) return null;

  const extent = wrapper.extent as XmlNode | undefined;
  const cxEmu = intAttr(extent, "@_cx");
  const cyEmu = intAttr(extent, "@_cy");

  // Floating positioning (<wp:anchor>) carries <wp:positionH> / <positionV>
  // each with <wp:posOffset>. Inline drawings are placed at the run's
  // current baseline so we treat their offset as 0.
  let xEmu = 0;
  let yEmu = 0;
  if (anchor) {
    const positionH = anchor.positionH as XmlNode | undefined;
    const positionV = anchor.positionV as XmlNode | undefined;
    const posOffsetH = positionH?.posOffset;
    const posOffsetV = positionV?.posOffset;
    if (posOffsetH != null) xEmu = parseInt(String(posOffsetH), 10) || 0;
    if (posOffsetV != null) yEmu = parseInt(String(posOffsetV), 10) || 0;
  }

  const graphic = wrapper.graphic as XmlNode | undefined;
  const graphicData = graphic?.graphicData as XmlNode | undefined;
  if (!graphicData) return null;

  const wsp = graphicData.wsp as XmlNode | undefined;
  const pic = graphicData.pic as XmlNode | undefined;

  let prstGeom: string | undefined;
  let shapeCx = 0;
  let shapeCy = 0;
  if (wsp) {
    const spPr = wsp.spPr as XmlNode | undefined;
    const xfrm = spPr?.xfrm as XmlNode | undefined;
    if (xfrm) {
      const off = xfrm.off as XmlNode | undefined;
      const ext = xfrm.ext as XmlNode | undefined;
      if (off) {
        const offX = intAttr(off, "@_x");
        const offY = intAttr(off, "@_y");
        if (offX) xEmu = offX;
        if (offY) yEmu = offY;
      }
      if (ext) {
        // <a:ext> on a shape is more authoritative than <wp:extent>
        // (the latter can be the bounding box including text wrap).
        shapeCx = intAttr(ext, "@_cx");
        shapeCy = intAttr(ext, "@_cy");
      }
    }
    const prstGeomNode = spPr?.prstGeom as XmlNode | undefined;
    if (prstGeomNode) {
      const prst = prstGeomNode["@_prst"];
      if (prst) prstGeom = String(prst);
    }
  }

  const position: DrawingPosition = {
    xEmu,
    yEmu,
    cxEmu: shapeCx > 0 ? shapeCx : cxEmu,
    cyEmu: shapeCy > 0 ? shapeCy : cyEmu,
  };

  let type: DrawingType;
  if (pic) {
    type = "image";
  } else if (wsp) {
    type = classifyShape(prstGeom);
  } else {
    return null;
  }

  return {
    type,
    position,
    direction: classifyDirection(position),
    paragraphIndex,
    prstGeom,
  };
}

/**
 * Top-level entry point: open a DOCX buffer, read `word/document.xml`,
 * extract every drawing.
 */
export async function extractDrawings(buffer: Buffer): Promise<Drawing[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return [];
  }
  const entry = zip.file("word/document.xml");
  if (!entry) return [];
  const xml = await entry.async("text");
  return extractDrawingsFromDocumentXml(xml);
}
