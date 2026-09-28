import { describe, expect, it, vi } from "vitest";
import type { ContentChunk, SessionLog, CognitiveProfile } from "@/types";
import { assembleArtifact } from "./knowledgeArtifact";

vi.mock("./storage", () => ({ saveArtifact: vi.fn().mockResolvedValue(undefined) }));

const profile: CognitiveProfile = {
  userId: "learner", learningStyle: "text", attentionSpan: "medium",
  anchorNeed: false, condition: "none", updatedAt: 0,
};

function chunk(id: string, sourceText: string, conceptTags: string[]): ContentChunk {
  return { id, sourceId: "https://example.org/biology", sourceType: "website", position: Number(id),
    sourceText, text: sourceText, conceptTags };
}

describe("completed-session topics", () => {
  it("retains complete terms present in original material and rejects fabricated or clipped tags", async () => {
    const log: SessionLog = { sessionId: "s1", userId: "learner", profile,
      sources: ["https://example.org/biology"], engagementMap: {}, startTime: 0, endTime: 10 };
    const artifact = await assembleArtifact(log, [
      chunk("0", "Photosynthesis converts light energy into chemical energy.", ["Photosynthesis", "quantum mechanics", "Photosyn"]),
      chunk("1", "The role of Photosynthesis in plants is important.", ["Photosynthesis"]),
    ], profile);
    expect(artifact.keyConcepts.map(c => c.label)).toEqual(["photosynthesis"]);
  });
});
