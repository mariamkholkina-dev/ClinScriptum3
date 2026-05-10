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

/**
 * Встраивает в DOCX ссылку на наш Word add-in (webextensions + taskpanes
 * parts) — Word при открытии файла автоматически загружает add-in в
 * правый task pane без необходимости юзера лезть в Insert → My Add-ins.
 *
 * Add-in должен быть зарегистрирован у юзера через Trusted Catalog
 * (на dev — `\\localhost\OfficeAddins` SMB share). `storeType="EXCatalog"`
 * + пустой `store` означает «найти add-in по id в любом доступном каталоге».
 *
 * `addinId` берётся из `apps/word-addin/manifest.xml` `<Id>`.
 */
export async function injectEmbeddedAddin(
  docxBuffer: Buffer,
  addinId: string,
  addinVersion = "1.0.0.0"
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const webextId = `{${crypto.randomUUID()}}`;

  const webextensionXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="${webextId}">`,
    `  <we:reference id="${addinId}" version="${addinVersion}" store="" storeType="EXCatalog"/>`,
    `  <we:alternateReferences/>`,
    `  <we:properties/>`,
    `  <we:bindings/>`,
    `  <we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
    `</we:webextension>`,
  ].join("\n");

  const taskpanesXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11">`,
    `  <wetp:taskpane dockstate="right" visibility="1" width="350" row="0">`,
    `    <wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>`,
    `  </wetp:taskpane>`,
    `</wetp:taskpanes>`,
  ].join("\n");

  const taskpanesRelsXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/>`,
    `</Relationships>`,
  ].join("\n");

  zip.file("word/webextensions/webextension1.xml", webextensionXml);
  zip.file("word/webextensions/taskpanes.xml", taskpanesXml);
  zip.file("word/webextensions/_rels/taskpanes.xml.rels", taskpanesRelsXml);

  // Override types в [Content_Types].xml
  const contentTypesXml = await zip.file("[Content_Types].xml")!.async("string");
  const overrides = [
    `<Override PartName="/word/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/>`,
    `<Override PartName="/word/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/>`,
  ].join("");
  zip.file(
    "[Content_Types].xml",
    contentTypesXml.replace("</Types>", `${overrides}</Types>`)
  );

  // Relationship document.xml → taskpanes.xml
  const docRelsPath = "word/_rels/document.xml.rels";
  if (zip.file(docRelsPath)) {
    let docRelsXml = await zip.file(docRelsPath)!.async("string");
    const newRel = `<Relationship Id="rIdEmbeddedAddin" Type="http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes" Target="webextensions/taskpanes.xml"/>`;
    docRelsXml = docRelsXml.replace("</Relationships>", `${newRel}</Relationships>`);
    zip.file(docRelsPath, docRelsXml);
  }

  const result = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(result);
}
