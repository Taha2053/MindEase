import { describe, expect, it } from "vitest";
import { personalDataKeys, sanitizeUserData } from "./userData";
import { STORAGE_KEYS } from "@/types";

describe("learner data controls", () => {
  it("never exports stored provider credentials", () => {
    const result = sanitizeUserData({ [STORAGE_KEYS.PROFILE]: { userId: "u" }, [STORAGE_KEYS.API_KEYS]: { mistralApiKey: "secret" }, [STORAGE_KEYS.AUTH_SESSION]: { accessToken: "secret" } });
    expect(result[STORAGE_KEYS.PROFILE]).toEqual({ userId: "u" });
    expect(result).not.toHaveProperty(STORAGE_KEYS.API_KEYS);
    expect(result).not.toHaveProperty(STORAGE_KEYS.AUTH_SESSION);
  });
  it("finds indexed session, artifact, and feedback data for deletion", () => {
    const keys = personalDataKeys({ session_a: {}, artifact_a: {}, mindease_feedback_a: {}, [STORAGE_KEYS.PROFILE]: {}, mindease_theme: "dark", [STORAGE_KEYS.API_KEYS]: {} });
    expect(keys).toEqual(expect.arrayContaining(["session_a", "artifact_a", "mindease_feedback_a", STORAGE_KEYS.PROFILE]));
    expect(keys).not.toContain("mindease_theme");
    expect(keys).not.toContain(STORAGE_KEYS.API_KEYS);
  });
});
