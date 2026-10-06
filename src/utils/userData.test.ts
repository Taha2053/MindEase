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
  it("includes deleted session ids and video draft in personal data keys for account isolation", () => {
    const keys = personalDataKeys({
      mindease_deleted_session_ids: ["s1"],
      mindease_video_draft: { id: "d1" },
      mindease_theme: "dark",
    });
    expect(keys).toEqual(expect.arrayContaining(["mindease_deleted_session_ids", "mindease_video_draft"]));
    expect(keys).not.toContain("mindease_theme");
  });
  it("excludes other accounts' session folders from export while preserving legacy and owned folders", () => {
    const exported = sanitizeUserData({
      [STORAGE_KEYS.AUTH_SESSION]: { user: { id: "user_a" } },
      [STORAGE_KEYS.API_KEYS]: { openAiApiKey: "secret" },
      [STORAGE_KEYS.SESSION_FOLDERS]: [
        { folderName: "folder_a", ownerAccountId: "user_a" },
        { folderName: "folder_b", ownerAccountId: "user_b" },
        { folderName: "folder_legacy" },
      ],
    });
    expect(exported).not.toHaveProperty(STORAGE_KEYS.AUTH_SESSION);
    expect(exported).not.toHaveProperty(STORAGE_KEYS.API_KEYS);
    const folders = exported[STORAGE_KEYS.SESSION_FOLDERS] as Array<{ folderName: string; ownerAccountId?: string }>;
    expect(folders).toEqual([
      { folderName: "folder_a", ownerAccountId: "user_a" },
      { folderName: "folder_legacy" },
    ]);
  });
});
