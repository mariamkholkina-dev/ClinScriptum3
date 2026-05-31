import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "../html-entities.js";

describe("decodeHtmlEntities", () => {
  it("decodes the common named entities", () => {
    expect(decodeHtmlEntities("Значения гематокрита &gt; 55%")).toBe("Значения гематокрита > 55%");
    expect(decodeHtmlEntities("a &lt; b &amp;&amp; c")).toBe("a < b && c");
    expect(decodeHtmlEntities("&quot;цитата&quot; и &apos;апостроф&apos;")).toBe('"цитата" и \'апостроф\'');
    expect(decodeHtmlEntities("неразрывный&nbsp;пробел")).toBe("неразрывный пробел");
  });

  it("decodes numeric (dec + hex) entities", () => {
    expect(decodeHtmlEntities("&#62;")).toBe(">");
    expect(decodeHtmlEntities("&#x3e;")).toBe(">");
    expect(decodeHtmlEntities("&#39;")).toBe("'");
  });

  it("does not double-decode (&amp; handled last)", () => {
    expect(decodeHtmlEntities("&amp;gt;")).toBe("&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(decodeHtmlEntities("обычный текст > 5")).toBe("обычный текст > 5");
  });
});
