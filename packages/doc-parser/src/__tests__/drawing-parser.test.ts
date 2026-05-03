import { describe, it, expect } from "vitest";
import { extractDrawingsFromDocumentXml } from "../drawing-parser.js";

// Minimal helper — every fixture wraps its body fragment in a real
// w:document envelope so fast-xml-parser sees the canonical structure.
function wrap(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <w:body>${body}</w:body>
</w:document>`;
}

function rightArrowParagraph(
  xEmu: number,
  yEmu: number,
  cxEmu: number,
  cyEmu: number,
): string {
  return `
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor>
            <wp:positionH relativeFrom="page"><wp:posOffset>${xEmu}</wp:posOffset></wp:positionH>
            <wp:positionV relativeFrom="page"><wp:posOffset>${yEmu}</wp:posOffset></wp:positionV>
            <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:spPr>
                    <a:xfrm>
                      <a:off x="${xEmu}" y="${yEmu}"/>
                      <a:ext cx="${cxEmu}" cy="${cyEmu}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom>
                  </wps:spPr>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>`;
}

describe("extractDrawingsFromDocumentXml", () => {
  it("returns empty array for malformed input", () => {
    expect(extractDrawingsFromDocumentXml("<not-xml>")).toEqual([]);
    expect(extractDrawingsFromDocumentXml("")).toEqual([]);
  });

  it("returns empty array when document has no drawings", () => {
    const xml = wrap("<w:p><w:r><w:t>Plain text</w:t></w:r></w:p>");
    expect(extractDrawingsFromDocumentXml(xml)).toEqual([]);
  });

  it("extracts a single horizontal rightArrow", () => {
    const xml = wrap(rightArrowParagraph(1000, 2000, 6000000, 100000));
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0]).toMatchObject({
      type: "arrow",
      direction: "horizontal",
      paragraphIndex: 0,
      prstGeom: "rightArrow",
      position: { xEmu: 1000, yEmu: 2000, cxEmu: 6000000, cyEmu: 100000 },
    });
  });

  it("classifies leftRightArrow as arrow type", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:anchor>
        <wp:extent cx="5000000" cy="200000"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:xfrm><a:off x="500" y="600"/><a:ext cx="5000000" cy="200000"/></a:xfrm>
              <a:prstGeom prst="leftRightArrow"/>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("arrow");
    expect(drawings[0].direction).toBe("horizontal");
  });

  it("classifies straightConnector1 as line", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:anchor>
        <wp:extent cx="3000000" cy="50000"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="50000"/></a:xfrm>
              <a:prstGeom prst="straightConnector1"/>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("line");
  });

  it("classifies leftBracket as bracket", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:inline>
        <wp:extent cx="100000" cy="2000000"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:xfrm><a:off x="100" y="200"/><a:ext cx="100000" cy="2000000"/></a:xfrm>
              <a:prstGeom prst="leftBracket"/>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("bracket");
    expect(drawings[0].direction).toBe("vertical");
  });

  it("classifies pic:pic as image", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:inline>
        <wp:extent cx="500000" cy="500000"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="500000"/></a:xfrm>
            </pic:spPr>
          </pic:pic>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("image");
  });

  it("attributes drawings to the right paragraphIndex when there are multiple paragraphs", () => {
    const xml = wrap(`
      <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
      ${rightArrowParagraph(0, 0, 4000000, 100000)}
      <w:p><w:r><w:t>Third paragraph</w:t></w:r></w:p>
      ${rightArrowParagraph(0, 0, 5000000, 80000)}`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(2);
    expect(drawings[0].paragraphIndex).toBe(1);
    expect(drawings[1].paragraphIndex).toBe(3);
  });

  it("recurses into nested w:tbl paragraphs", () => {
    const xml = wrap(`
      <w:p><w:r><w:t>Before table</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc>${rightArrowParagraph(0, 0, 6000000, 100000)}</w:tc>
        </w:tr>
      </w:tbl>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("arrow");
  });

  it("descends into AlternateContent/Choice (DrawingML branch)", () => {
    const xml = wrap(`
      <w:p>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing><wp:anchor>
                <wp:extent cx="3500000" cy="120000"/>
                <a:graphic><a:graphicData>
                  <wps:wsp>
                    <wps:spPr>
                      <a:xfrm><a:off x="0" y="0"/><a:ext cx="3500000" cy="120000"/></a:xfrm>
                      <a:prstGeom prst="rightArrow"/>
                    </wps:spPr>
                  </wps:wsp>
                </a:graphicData></a:graphic>
              </wp:anchor></w:drawing>
            </mc:Choice>
            <mc:Fallback>
              <w:pict><v:shape type="#_x0000_t13"/></w:pict>
            </mc:Fallback>
          </mc:AlternateContent>
        </w:r>
      </w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("arrow");
  });

  it("returns shape (no specific type) for unknown prstGeom", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:anchor>
        <wp:extent cx="100000" cy="100000"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>
              <a:prstGeom prst="rect"/>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].type).toBe("shape");
    expect(drawings[0].direction).toBeUndefined();
  });

  it("handles drawings without a:xfrm by falling back to wp:extent", () => {
    const xml = wrap(`
      <w:p><w:r><w:drawing><wp:inline>
        <wp:extent cx="2500000" cy="60000"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:prstGeom prst="rightArrow"/>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>`);
    const drawings = extractDrawingsFromDocumentXml(xml);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].position.cxEmu).toBe(2500000);
    expect(drawings[0].position.cyEmu).toBe(60000);
    expect(drawings[0].direction).toBe("horizontal");
  });
});
