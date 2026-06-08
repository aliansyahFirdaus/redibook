import { describe, expect, it } from "vitest";
import { combineScores } from "./index.js";

describe("combineScores", () => {
  it("uses the required lexical and semantic weights", () => {
    expect(combineScores(1, 0)).toBe(0.45);
    expect(combineScores(0, 1)).toBe(0.55);
  });
});
