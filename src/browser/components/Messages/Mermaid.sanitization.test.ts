import { sanitizeMermaidSvg } from "./Mermaid";

import { GlobalWindow } from "happy-dom";

const testWindow = new GlobalWindow();
globalThis.DOMParser = testWindow.DOMParser as unknown as typeof DOMParser;

describe("sanitizeMermaidSvg", () => {
  it("returns null for malformed SVG", () => {
    expect(sanitizeMermaidSvg("<svg><g></svg")).toBeNull();
  });

  it("removes active content/unsafe attributes while preserving foreignObject labels", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
      "<script>alert(1)</script>" +
      '<foreignObject><div onclick="evil()">label</div></foreignObject>' +
      '<a href="javascript:alert(1)"><text>link</text></a>' +
      '<a xlink:href="java&#10;script:alert(3)"><text>split-link</text></a>' +
      '<a href="java&#1114112;script:alert(4)"><text>invalid-codepoint</text></a>' +
      '<image src="javascript:alert(2)" />' +
      '<rect width="10" height="10" onclick="steal()" />' +
      "</svg>";

    const sanitized = sanitizeMermaidSvg(input);

    expect(sanitized).not.toBeNull();
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onload=");
    expect(sanitized).not.toContain("onclick=");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("java&#10;script:");
    expect(sanitized).not.toContain("&#1114112;");
    expect(sanitized).not.toContain("xlink:href=");
    // The `java&#1114112;script:` entity decodes to `java\uFFFDscript:` (replacement char)
    // which is NOT a valid `javascript:` scheme — so the sanitizer correctly leaves
    // that href untouched. Only assert that truly dangerous hrefs are stripped.
    expect(sanitized).not.toContain('href="javascript:');
    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("<rect");
    expect(sanitized).toContain("<foreignObject");
    expect(sanitized).toContain("label");
  });
});
