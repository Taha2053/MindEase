import { describe, expect, it } from "vitest";
import { personalDataKeys } from "./userData";
import { STORAGE_KEYS } from "@/types";

describe("userData purge keys", () => {
  it("includes all sensitive session and explanation storage keys", () => {
    const keys = personalDataKeys({
      [STORAGE_KEYS.EXPLANATIONS]: {},
      [STORAGE_KEYS.SESSION_FOLDERS]: [],
      [STORAGE_KEYS.RL_ADAPTATION_LOG]: [],
      [STORAGE_KEYS.ACTIVE_LAYER3_SESSION]: {},
      latestReviewChunks: {},
      mindease_saved_videos: [],
    });

    expect(keys).toContain(STORAGE_KEYS.EXPLANATIONS);
    expect(keys).toContain(STORAGE_KEYS.SESSION_FOLDERS);
    expect(keys).toContain(STORAGE_KEYS.RL_ADAPTATION_LOG);
    expect(keys).toContain("latestReviewChunks");
    expect(keys).toContain("mindease_saved_videos");
  });
});
