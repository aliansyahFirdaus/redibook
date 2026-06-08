import { describe, expect, it } from "vitest";
import {
  collectOutlineLeafDocuments,
  extractOutlineCollectionId,
  extractOutlineDocumentId,
  flattenOutlineDocumentTree,
  shouldIndexOutlineDocument,
  type OutlineDocumentTreeNode,
} from "./sources.module.js";

describe("outline source helpers", () => {
  it("extracts document and collection slugs from Outline URLs", () => {
    expect(extractOutlineDocumentId("https://docs.example.com/doc/crew-lvvQXRsfmu")).toBe("crew-lvvQXRsfmu");
    expect(extractOutlineCollectionId("https://docs.example.com/collection/redibook-Kx92LdQ")).toBe("redibook-Kx92LdQ");
  });

  it("flattens nested collection trees into leaf document IDs only", () => {
    const tree: OutlineDocumentTreeNode[] = [
      {
        id: "root",
        children: [
          { id: "child-a", children: [] },
          {
            id: "child-b",
            children: [{ id: "grandchild", children: [] }],
          },
        ],
      },
    ];

    expect(flattenOutlineDocumentTree(tree)).toEqual(["child-a", "grandchild"]);
  });

  it("collects leaf ancestry so sprint groups can be derived without indexing parents", () => {
    const tree: OutlineDocumentTreeNode[] = [
      {
        id: "sprint-3",
        title: "Sprint 3",
        url: "https://docs.example.com/doc/sprint-3",
        children: [
          {
            id: "story-a",
            title: "Crew settings",
            url: "https://docs.example.com/doc/story-a",
            children: [],
          },
          {
            id: "topic-b",
            title: "Payroll",
            children: [
              {
                id: "story-b",
                title: "Payroll export",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    expect(collectOutlineLeafDocuments(tree)).toEqual([
      {
        id: "story-a",
        title: "Crew settings",
        url: "https://docs.example.com/doc/story-a",
        ancestry: [{ id: "sprint-3", title: "Sprint 3", url: "https://docs.example.com/doc/sprint-3" }],
        orderPath: [0, 0],
      },
      {
        id: "story-b",
        title: "Payroll export",
        url: undefined,
        ancestry: [
          { id: "sprint-3", title: "Sprint 3", url: "https://docs.example.com/doc/sprint-3" },
          { id: "topic-b", title: "Payroll", url: undefined },
        ],
        orderPath: [0, 1, 0],
      },
    ]);
  });

  it("skips indexing unchanged ready or active Outline documents", () => {
    expect(shouldIndexOutlineDocument("same", "same", "ready")).toBe(false);
    expect(shouldIndexOutlineDocument("same", "same", "pending")).toBe(false);
    expect(shouldIndexOutlineDocument("same", "same", "normalizing")).toBe(false);
    expect(shouldIndexOutlineDocument("same", "same", "embedding")).toBe(false);
  });

  it("indexes changed or failed Outline documents", () => {
    expect(shouldIndexOutlineDocument("old", "new", "ready")).toBe(true);
    expect(shouldIndexOutlineDocument("same", "same", "failed")).toBe(true);
  });
});
