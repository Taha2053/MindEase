import { describe, expect, it } from "vitest";
import { rankAdaptations } from "./recommendations";

describe("initial recommendation policy", () => {
  it("respects explicit format preference", () => {
    expect(rankAdaptations({ formatPreference: "visual" })[0].choice).toBe("visual");
    expect(rankAdaptations({ formatPreference: "text" })[0].choice).toBe("structured");
  });
  it("uses a conservative fallback with both available alternatives", () => {
    expect(rankAdaptations().map(item => item.choice)).toEqual(["structured", "visual"]);
    expect(rankAdaptations()[0].reason).not.toContain("You selected");
  });
});
