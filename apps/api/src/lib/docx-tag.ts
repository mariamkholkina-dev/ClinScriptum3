import JSZip from "jszip";

const CLINSCRIPTUM_NS = "urn:clinscriptum:word-session";
const CUSTOM_XML_FOLDER = "customXml";

/**
 * Injects a Custom XML Part containing the sessionId into a .docx buffer.
 * Office.js can read it via `customXmlParts.getByNamespaceAsync`.
 */
export async function injectSessionXml(
  docxBuffer: Buffer,
  sessionId: string
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);

  const existingParts = Object.keys(zip.files).filter(
    (f) => f.startsWith(`${CUSTOM_XML_FOLDER}/`) && f.endsWith(".xml")
  );
  const nextIndex = existingParts.length + 1;

  const partPath = `${CUSTOM_XML_FOLDER}/item${nextIndex}.xml`;
  const propPath = `${CUSTOM_XML_FOLDER}/itemProps${nextIndex}.xml`;

  const partContent = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ClinScriptumSession xmlns="${CLINSCRIPTUM_NS}">`,
    `  <SessionId>${sessionId}</SessionId>`,
    `</ClinScriptumSession>`,
  ].join("\n");

  const propContent = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<ds:datastoreItem ds:itemID="{${crypto.randomUUID()}}"`,
    `  xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">`,
    `  <ds:schemaRefs>`,
    `    <ds:schemaRef ds:uri="${CLINSCRIPTUM_NS}"/>`,
    `  </ds:schemaRefs>`,
    `</ds:datastoreItem>`,
  ].join("\n");

  zip.file(partPath, partContent);
  zip.file(propPath, propContent);

  const contentTypesXml = await zip.file("[Content_Types].xml")!.async("string");
  if (!contentTypesXml.includes('"/customXml/')) {
    const overrides = [
      `<Override PartName="/${partPath}" ContentType="application/xml"/>`,
      `<Override PartName="/${propPath}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`,
    ].join("");
    const updated = contentTypesXml.replace("</Types>", `${overrides}</Types>`);
    zip.file("[Content_Types].xml", updated);
  } else {
    const overrides = [
      `<Override PartName="/${partPath}" ContentType="application/xml"/>`,
      `<Override PartName="/${propPath}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`,
    ].join("");
    const updated = contentTypesXml.replace("</Types>", `${overrides}</Types>`);
    zip.file("[Content_Types].xml", updated);
  }

  const relsPath = "word/_rels/document.xml.rels";
  if (zip.file(relsPath)) {
    let relsXml = await zip.file(relsPath)!.async("string");
    const relId = `rClinsSession${nextIndex}`;
    const newRel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="/${partPath}"/>`;
    relsXml = relsXml.replace("</Relationships>", `${newRel}</Relationships>`);
    zip.file(relsPath, relsXml);
  }

  const result = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(result);
}
