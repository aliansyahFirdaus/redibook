import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronRight } from "lucide-solid";
import { For, Match, Show, Switch } from "solid-js";
import { api, type Source } from "../lib/api";
import { AppShell, ErrorState, LoadingState, StatusPill } from "../components/shell";

type SourceTreeNode = {
  name: string;
  order: number;
  children: Map<string, SourceTreeNode>;
  source: Source | null;
};

export default function Sources() {
  const queryClient = useQueryClient();
  const sources = createQuery(() => ({
    queryKey: ["sources"],
    queryFn: () => api<{ items: Source[]; nextCursor: string | null }>("/sources?limit=250"),
    refetchInterval: (query) => query.state.data?.items.some((item) =>
      ["pending", "normalizing", "embedding"].includes(item.indexStatus)) ? 2_000 : false,
  }));
  const outlineCollectionMutation = createMutation(() => ({
    mutationFn: (reference: string) => api("/sources/outline/collection/sync", {
      method: "POST",
      body: JSON.stringify(
        reference.startsWith("http")
          ? { url: reference }
          : { collectionId: reference },
      ),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  }));
  const resetSourcesMutation = createMutation(() => ({
    mutationFn: () => api<{ status: "deleted"; deleted: number }>("/sources/reset", {
      method: "POST",
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  }));

  const collections = () => buildCollectionTrees(sources.data?.items ?? []);

  return (
    <AppShell
      eyebrow="Knowledge ledger"
      title="Sources"
      headerContent={(
        <CollectionSyncForm mutation={outlineCollectionMutation} />
      )}
    >
      <section class="section-block source-table-block">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Indexed inventory</p>
            <h2>Outline collections</h2>
          </div>
          <div class="sources-toolbar">
            <span class="count-label">{sources.data?.items.length ?? 0} documents</span>
            <button
              class="button button-danger"
              type="button"
              disabled={resetSourcesMutation.isPending || !sources.data?.items.length}
              onClick={() => {
                if (!window.confirm("Delete all synced source documents and indexed chunks?")) return;
                resetSourcesMutation.mutate();
              }}
            >
              {resetSourcesMutation.isPending ? "Resetting..." : "Reset docs"}
            </button>
          </div>
        </div>

        <Show when={resetSourcesMutation.isError}>
          <p class="form-error" role="alert">{resetSourcesMutation.error?.message}</p>
        </Show>
        <Show when={resetSourcesMutation.isSuccess}>
          <p class="form-note" role="status">
            Removed {resetSourcesMutation.data?.deleted ?? 0} source documents from the ledger.
          </p>
        </Show>

        <Switch>
          <Match when={sources.isPending}>
            <LoadingState label="Loading sources..." />
          </Match>
          <Match when={sources.isError}>
            <ErrorState error={sources.error} />
          </Match>
          <Match when={sources.data}>
            <div class="collection-tree-list">
              <For each={collections()} fallback={<div class="empty-state">No synced collections yet.</div>}>
                {(collection) => (
                  <section class="collection-tree">
                    <div class="collection-tree-header">
                      <div>
                        <p class="eyebrow">Collection</p>
                        <h3>{collection.name}</h3>
                      </div>
                      <span class="count-label">{collection.count} documents</span>
                    </div>
                    <div class="collection-tree-body">
                      <For each={sortTreeNodes([...collection.root.children.values()])}>
                        {(child) => <TreeNodeView node={child} depth={0} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["sources"] })} />}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </section>
    </AppShell>
  );
}

function CollectionSyncForm(props: {
  mutation: ReturnType<typeof createMutation<unknown, Error, string, unknown>>;
}) {
  let inputRef: HTMLInputElement | undefined;

  return (
    <div class="page-header-utility">
      <form
        class="header-sync-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = inputRef?.value.trim() ?? "";
          if (!value) return;
          props.mutation.mutate(value, {
            onSuccess: () => {
              if (inputRef) inputRef.value = "";
            },
          });
        }}
      >
        <label class="sr-only" for="outline-collection-reference">Outline collection URL or ID</label>
        <input
          id="outline-collection-reference"
          ref={(element) => {
            inputRef = element;
          }}
          placeholder="Paste Outline collection URL or ID"
          required
        />
        <button class="button button-quiet" type="submit" disabled={props.mutation.isPending}>
          {props.mutation.isPending ? "Syncing..." : "Sync"}
        </button>
      </form>
      <Show when={props.mutation.isError}>
        <p class="form-error header-feedback" role="alert">{props.mutation.error?.message}</p>
      </Show>
      <Show when={props.mutation.isSuccess}>
        <p class="form-note header-feedback" role="status">Collection accepted. Documents are queued for indexing in the background.</p>
      </Show>
    </div>
  );
}

function TreeNodeView(props: {
  node: SourceTreeNode;
  depth: number;
  onRefresh: () => void;
}) {
  const children = () => sortTreeNodes([...props.node.children.values()]);
  const hasChildren = () => children().length > 0;

  return (
    <Show
      when={hasChildren()}
      fallback={<LeafSourceRow source={props.node.source!} depth={props.depth} onRefresh={props.onRefresh} />}
    >
      <details class="tree-branch" open>
        <summary style={{ "padding-left": `${24 + props.depth * 22}px` }}>
          <span class="tree-label">
            {props.node.name}
            <ChevronRight class="tree-arrow" size={16} aria-hidden="true" />
          </span>
          <span class="tree-meta">{countLeaves(props.node)} docs</span>
        </summary>
        <div class="tree-children">
          <For each={children()}>
            {(child) => <TreeNodeView node={child} depth={props.depth + 1} onRefresh={props.onRefresh} />}
          </For>
        </div>
      </details>
    </Show>
  );
}

function LeafSourceRow(props: { source: Source; depth: number; onRefresh: () => void }) {
  const reindex = createMutation(() => ({
    mutationFn: () => api(`/sources/${props.source.id}/index`, { method: "POST" }),
    onSuccess: props.onRefresh,
  }));

  return (
    <div class="tree-leaf" style={{ "padding-left": `${24 + props.depth * 22}px` }}>
      <div class="tree-leaf-main">
        <div class="tree-label">
          <strong>{props.source.title}</strong>
        </div>
        <Show when={props.source.indexError}>
          <small class="table-error">{props.source.indexError}</small>
        </Show>
      </div>
      <div class="tree-leaf-meta">
        <StatusPill status={props.source.indexStatus} />
        <span class="row-date">{new Date(props.source.updatedAt).toLocaleString()}</span>
        <button class="table-action" onClick={() => reindex.mutate()} disabled={reindex.isPending}>Re-index</button>
      </div>
    </div>
  );
}

function buildCollectionTrees(sources: Source[]) {
  const collections = new Map<string, { name: string; root: SourceTreeNode; count: number }>();

  for (const source of sources) {
    const collectionName = source.collectionName ?? "Unlabeled collection";
    const existing = collections.get(collectionName) ?? {
      name: collectionName,
      root: createTreeNode(collectionName, 0),
      count: 0,
    };
    existing.count += 1;
    collections.set(collectionName, existing);

    let pointer = existing.root;
    const path = source.outlinePath.length ? source.outlinePath : [source.title];
    for (const [depth, segment] of path.entries()) {
      const order = source.outlineOrder[depth] ?? 0;
      const next = pointer.children.get(segment) ?? createTreeNode(segment, order);
      next.order = Math.min(next.order, order);
      pointer.children.set(segment, next);
      pointer = next;
    }
    pointer.source = source;
  }

  return [...collections.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function createTreeNode(name: string, order: number): SourceTreeNode {
  return {
    name,
    order,
    children: new Map(),
    source: null,
  };
}

function sortTreeNodes(nodes: SourceTreeNode[]) {
  return [...nodes].sort((left, right) =>
    left.order === right.order
      ? left.name.localeCompare(right.name)
      : left.order - right.order);
}

function countLeaves(node: SourceTreeNode): number {
  if (!node.children.size) return node.source ? 1 : 0;
  return [...node.children.values()].reduce((sum, child) => sum + countLeaves(child), 0);
}
