import { describe, expect, it } from "vitest";
import { isExcludedPage } from "./pagePrivacy";

describe("sensitive page exclusions", () => {
  it("excludes private browser contexts and non-web URLs", () => {
    expect(isExcludedPage("https://example.org/course", true)).toBe(true);
    for (const url of ["about:config", "chrome://settings", "file:///private.pdf", "invalid"]) expect(isExcludedPage(url)).toBe(true);
  });
  it("excludes known private services and sensitive paths", () => {
    for (const url of ["https://mail.google.com/inbox", "https://example.org/checkout", "https://patient.example.org", "https://login.microsoftonline.com/"]) expect(isExcludedPage(url)).toBe(true);
  });
  it("does not treat a substring or query as a private hostname", () => {
    expect(isExcludedPage("https://example.org/course?topic=banking")).toBe(false);
    expect(isExcludedPage("https://paypal.com.example.org/course")).toBe(false);
  });
});
