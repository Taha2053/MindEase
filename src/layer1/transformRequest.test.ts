import { describe, expect, it } from "vitest";
import { isTransformRequest } from "./transformRequest";

describe("adaptation request boundary", () => {
  it("requires an explicit supported choice", () => {
    const input = { text: "Original source.", pageType: "website" };
    expect(isTransformRequest(input)).toBe(false);
    expect(isTransformRequest({ ...input, adaptation: "automatic" })).toBe(false);
    for (const adaptation of ["structured", "visual"]) {
      expect(isTransformRequest({ ...input, adaptation })).toBe(true);
    }
  });

  it("rejects malformed messages without throwing", () => {
    for (const input of [null, undefined, 42, {}, { text: 42 },
      { text: " ", pageType: "website", adaptation: "visual" },
      { text: "Source", pageType: "unknown", adaptation: "visual" }]) {
      expect(isTransformRequest(input)).toBe(false);
    }
  });
});
