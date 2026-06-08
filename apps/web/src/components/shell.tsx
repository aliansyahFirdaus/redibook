import { A, useLocation } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createEffect, Show } from "solid-js";
import type { JSX, ParentProps } from "solid-js";
import { LayoutDashboard, BookOpen, FlaskConical } from "lucide-solid";
import { api, type AnalysisRun } from "../lib/api";
import { clearLastActiveAnalysisId, findActiveAnalysis, getLastActiveAnalysisId, isActiveAnalysisStatus, setLastActiveAnalysisId, setLastAnalysisId } from "../lib/analysis-state";

const navItems = [
  { href: "/", label: "Workspace", icon: LayoutDashboard },
  { href: "/sources", label: "Sources", icon: BookOpen },
  { href: "/analyze", label: "Analyze", icon: FlaskConical },
];

export function AppShell(props: ParentProps<{ eyebrow?: string; title: string; description?: string; headerContent?: JSX.Element }>) {
  const location = useLocation();
  const analyses = createQuery(() => ({
    queryKey: ["analyses"],
    queryFn: () => api<{ items: AnalysisRun[] }>("/analyses"),
    refetchInterval: (query) => findActiveAnalysis(query.state.data?.items) ? 1_500 : false,
  }));
  const health = createQuery(() => ({
    queryKey: ["sidebar-health"],
    queryFn: () => api<{
      status: string;
      database: string;
      redis: string;
      ai: {
        embedding: { provider: string; model: string };
        reasoning: { provider: string; model: string };
      };
    }>("/health"),
    staleTime: 30_000,
  }));
  const reasoning = () => health.data?.ai.reasoning;
  const embedding = () => health.data?.ai.embedding;
  const providerLabel = () => toTitleCase(reasoning()?.provider ?? "unknown");
  const activeAnalysis = () => findActiveAnalysis(analyses.data?.items);

  createEffect(() => {
    const active = activeAnalysis();
    if (active) {
      setLastAnalysisId(active.id);
      setLastActiveAnalysisId(active.id);
      return;
    }

    const storedId = getLastActiveAnalysisId();
    const storedRun = analyses.data?.items.find((run) => run.id === storedId);
    if (storedRun && !isActiveAnalysisStatus(storedRun.status)) clearLastActiveAnalysisId(storedRun.id);
  });

  return (
    <div class="app-shell">
      <aside class="sidebar">
        <A href="/" class="brand" aria-label="Redibook home">
          <span>redibook</span>
        </A>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => (
            <A
              href={item.href}
              class="nav-link"
              classList={{ active: item.href === "/" ? location.pathname === "/" : location.pathname.startsWith(item.href) }}
            >
              <item.icon aria-hidden="true" class="nav-icon" size={18} />
              <span class="nav-label">{item.label}</span>
              <Show when={item.href === "/analyze" && activeAnalysis()}>
                <span class="nav-activity" title={`Analysis ${activeAnalysis()?.status}`}>
                  <span class="sr-only">Analysis in progress</span>
                </span>
              </Show>
            </A>
          ))}
        </nav>
        <div class="sidebar-note">
          <span class="sidebar-kicker">AI Runtime</span>
          <strong>{providerLabel()}</strong>
          <dl class="sidebar-runtime">
            <div>
              <dt>Reasoning</dt>
              <dd>{reasoning()?.model ?? "unavailable"}</dd>
            </div>
            <div>
              <dt>Embedding</dt>
              <dd>{embedding()?.model ?? "unavailable"}</dd>
            </div>
          </dl>
        </div>
      </aside>
      <main class="workspace">
        <header class="page-header">
          <div>
            {props.eyebrow ? <p class="eyebrow">{props.eyebrow}</p> : null}
            <h1>{props.title}</h1>
            {props.description ? <p class="lede">{props.description}</p> : null}
            {props.headerContent}
          </div>
        </header>
        {props.children}
      </main>
    </div>
  );
}

export function LoadingState(props: { label: string }) {
  return <div class="state-panel" role="status" aria-live="polite"><span class="spinner" />{props.label}</div>;
}

export function ErrorState(props: { error: unknown }) {
  const message = props.error instanceof Error ? props.error.message : "An unexpected error occurred.";
  return <div class="state-panel error" role="alert"><strong>Unable to load this view.</strong><span>{message}</span></div>;
}

export function StatusPill(props: { status: string }) {
  return <span class={`status-pill status-${props.status}`}>{props.status.replace("-", " ")}</span>;
}

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
