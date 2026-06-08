import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./index.js";

describe("chunkMarkdown", () => {
  it("preserves heading paths and stable ordinals", () => {
    const chunks = chunkMarkdown("# Login\n\nUsers sign in.\n\n## Lockout\n\nFive failed attempts lock the account.", 20, 4);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(chunks.at(-1)?.sectionPath).toEqual(["Login", "Lockout"]);
  });
});
