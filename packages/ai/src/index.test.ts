import { describe, expect, it } from "vitest";
import {
  MockEmbeddingProvider,
  MockReasoningProvider,
  OpenRouterEmbeddingProvider,
  OpenRouterReasoningProvider,
  checkRequirementQuality,
  selectEmbeddingProvider,
  selectReasoningProvider,
} from "./index.js";

describe("AI providers", () => {
  it("selects mocks without credentials", () => {
    expect(selectEmbeddingProvider({} as NodeJS.ProcessEnv).name).toBe("mock");
    expect(selectReasoningProvider({} as NodeJS.ProcessEnv).name).toBe("mock");
  });

  it("prefers OpenRouter when configured", () => {
    expect(selectEmbeddingProvider({ OPENROUTER_API_KEY: "or-key" } as NodeJS.ProcessEnv)).toBeInstanceOf(OpenRouterEmbeddingProvider);
    expect(selectReasoningProvider({ OPENROUTER_API_KEY: "or-key" } as NodeJS.ProcessEnv)).toBeInstanceOf(OpenRouterReasoningProvider);
  });

  it("creates deterministic normalized embeddings", async () => {
    const provider = new MockEmbeddingProvider();
    const [first, second] = await provider.embed(["login failures", "login failures"]);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1536);
  });

  it("returns evidence-backed mock analysis", async () => {
    const result = await new MockReasoningProvider().analyze("A user must lock after five failures", [{
      chunkId: "11111111-1111-4111-8111-111111111111",
      documentId: "22222222-2222-4222-8222-222222222222",
      title: "Authentication",
      section: "Lockout",
      content: "Accounts lock after three failures.",
      lexicalScore: 1,
      semanticScore: 1,
      combinedScore: 1,
    }]);
    expect(result.affectedKnowledge[0]?.evidenceChunkIds).toEqual(result.evidenceChunkIds);
  });
});

describe("requirement quality", () => {
  it("is deterministic and non-blocking", () => {
    const result = checkRequirementQuality("When a user fails login five times, the system must lock the account; verify access fails.");
    expect(result.score).toBeGreaterThan(50);
  });
});
