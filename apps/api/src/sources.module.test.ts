import { describe, expect, it, vi } from "vitest";
import {
  collectOutlineLeafDocuments,
  extractOutlineCollectionId,
  extractOutlineDocumentId,
  flattenOutlineDocumentTree,
  SourcesService,
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

  it("removes stale docs only for the active Outline collection scope", async () => {
    const docs = [
      { id: "doc-stale", source_type: "outline", metadata: { collectionId: "col-a" }, outline_document_id: "stale-doc" },
      { id: "doc-keep", source_type: "outline", metadata: { collectionId: "col-a" }, outline_document_id: "keep-doc" },
      { id: "doc-other", source_type: "outline", metadata: { collectionId: "col-b" }, outline_document_id: "other-doc" },
      { id: "doc-manual", source_type: "manual", metadata: { collectionId: "col-a" }, outline_document_id: "manual-doc" },
      { id: "doc-missing-outline-id", source_type: "outline", metadata: { collectionId: "col-a" }, outline_document_id: null },
    ];
    const groups = [
      { id: "group-stale", group_type: "sprint", outline_collection_id: "col-a" },
      { id: "group-keep", group_type: "sprint", outline_collection_id: "col-a" },
      { id: "group-other", group_type: "sprint", outline_collection_id: "col-b" },
    ];
    const links = [
      { group_id: "group-stale", document_id: "doc-stale" },
      { group_id: "group-keep", document_id: "doc-keep" },
      { group_id: "group-other", document_id: "doc-other" },
    ];

    const database = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("DELETE FROM source_documents")) {
          const [collectionId, activeIds] = params as [string, string[]];
          const removed = docs.filter((doc) =>
            doc.source_type === "outline"
            && doc.metadata.collectionId === collectionId
            && doc.outline_document_id !== null
            && !activeIds.includes(doc.outline_document_id),
          );
          for (const doc of removed) {
            const index = docs.findIndex((item) => item.id === doc.id);
            if (index >= 0) docs.splice(index, 1);
          }
          for (let index = links.length - 1; index >= 0; index -= 1) {
            if (removed.some((doc) => doc.id === links[index]!.document_id)) links.splice(index, 1);
          }
          return { rows: removed.map((doc) => ({ id: doc.id })), rowCount: removed.length };
        }

        if (sql.includes("DELETE FROM source_groups sg")) {
          const [collectionId] = params as [string];
          const removed = groups.filter((group) =>
            group.group_type === "sprint"
            && group.outline_collection_id === collectionId
            && !links.some((link) => link.group_id === group.id),
          );
          for (const group of removed) {
            const index = groups.findIndex((item) => item.id === group.id);
            if (index >= 0) groups.splice(index, 1);
          }
          return { rows: [], rowCount: removed.length };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
    };
    const queue = { add: vi.fn() };
    const service = new SourcesService(database as never, queue as never);

    const removed = await (service as any).removeStaleCollectionDocuments("col-a", ["keep-doc"]);

    expect(removed).toBe(1);
    expect(docs.map((doc) => doc.id)).toEqual([
      "doc-keep",
      "doc-other",
      "doc-manual",
      "doc-missing-outline-id",
    ]);
    expect(groups.map((group) => group.id)).toEqual(["group-keep", "group-other"]);
  });

  it("does not run stale cleanup when sync fails midway", async () => {
    const service = new SourcesService({ query: vi.fn() } as never, { add: vi.fn() } as never);
    const cleanup = vi.fn();

    (service as any).fetchOutlineCollectionInfo = vi.fn().mockResolvedValue({
      id: "col-a",
      name: "Collection A",
      url: "https://docs.example.com/collection/col-a",
    });
    (service as any).fetchOutlineCollectionTree = vi.fn().mockResolvedValue([
      { id: "doc-1", title: "Doc 1", children: [] },
      { id: "doc-2", title: "Doc 2", children: [] },
    ]);
    (service as any).fetchOutlineDocument = vi.fn()
      .mockResolvedValueOnce({ id: "doc-1", title: "Doc 1", text: "Body 1", url: "https://docs.example.com/doc/doc-1" })
      .mockRejectedValueOnce(new Error("Outline documents.info failed"));
    (service as any).upsertOutlineDocument = vi.fn().mockResolvedValue({
      id: "source-1",
      indexRevision: 2,
      changed: true,
      enqueued: true,
    });
    (service as any).upsertSprintGroup = vi.fn().mockResolvedValue("group-1");
    (service as any).replaceDocumentSprintGroup = vi.fn().mockResolvedValue(undefined);
    (service as any).removeStaleCollectionDocuments = cleanup;

    await expect(service.syncOutlineCollection({
      collectionId: "col-a",
    })).rejects.toThrow("Outline documents.info failed");
    expect(cleanup).not.toHaveBeenCalled();
  });
});
