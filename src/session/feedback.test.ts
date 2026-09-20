import { describe, expect, it } from "vitest";
import { isSessionFeedback } from "./feedback";

describe("session feedback validation", () => {
  const feedback = { sessionId: "session-1", helpfulness: "partly", confidence: "low", preferredFormat: "text", comment: "More examples", updatedAt: 123 };
  it("keeps helpfulness and confidence as separate reports", () => {
    expect(isSessionFeedback(feedback)).toBe(true);
    expect(isSessionFeedback({ ...feedback, confidence: "diagnosed" })).toBe(false);
  });
  it("rejects corrupt records and unbounded comments", () => {
    expect(isSessionFeedback(null)).toBe(false);
    expect(isSessionFeedback({ ...feedback, sessionId: "" })).toBe(false);
    expect(isSessionFeedback({ ...feedback, comment: "x".repeat(2001) })).toBe(false);
    expect(isSessionFeedback({ ...feedback, updatedAt: NaN })).toBe(false);
  });
});
