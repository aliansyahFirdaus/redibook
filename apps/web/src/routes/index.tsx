import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { For, Match, Switch } from "solid-js";
import { api, type AnalysisRun } from "../lib/api";
import { AppShell, ErrorState, LoadingState, StatusPill } from "../components/shell";

export default function Home() {
  const analyses = createQuery(() => ({
    queryKey: ["analyses"],
    queryFn: () => api<{ items: AnalysisRun[] }>("/analyses"),
  }));

  return (
    <AppShell
      eyebrow="Product knowledge / impact desk"
      title="Turn requirements into traceable decisions."
      description="Index the source of truth, surface conflicts, and keep every conclusion tied to evidence."
    >
      <section class="hero-grid">
        <div class="hero-card">
          <span class="hero-number">01</span>
          <h2>Ask a precise product question</h2>
          <p>Quality checks flag gaps without blocking your analysis.</p>
          <A href="/analyze" class="button button-primary">Start an analysis</A>
        </div>
        <div class="hero-card dark">
          <span class="hero-number">02</span>
          <h2>Build the knowledge ledger</h2>
          <p>Sync the Outline collections that define your product knowledge and planning flow.</p>
          <A href="/sources" class="button button-quiet">Manage sources</A>
        </div>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Recent desk work</p>
            <h2>Latest analyses</h2>
          </div>
          <A href="/analyze" class="text-link">New analysis <span aria-hidden="true">→</span></A>
        </div>
        <Switch>
          <Match when={analyses.isPending}><LoadingState label="Loading recent analyses..." /></Match>
          <Match when={analyses.isError}><ErrorState error={analyses.error} /></Match>
          <Match when={analyses.data}>
            <div class="analysis-list">
              <For each={analyses.data?.items} fallback={<div class="empty-state">No analyses yet. Start with a requirement that changes existing behavior.</div>}>
                {(run) => (
                  <A href={`/analysis/${run.id}`} class="analysis-row">
                    <div>
                      <span class="row-date">{new Date(run.createdAt).toLocaleDateString()}</span>
                      <h3>{run.requirement}</h3>
                    </div>
                    <StatusPill status={run.status} />
                  </A>
                )}
              </For>
            </div>
          </Match>
        </Switch>
      </section>
    </AppShell>
  );
}
