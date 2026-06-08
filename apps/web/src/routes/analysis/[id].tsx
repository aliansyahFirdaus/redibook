import { A, useParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, For, Match, Show, Switch } from "solid-js";
import {
  api,
  type AnalysisRun,
  type DeliveryAnalysisResult,
  type ImpactAnalysisResult,
  type LegacyDeliveryAnalysisResult,
} from "../../lib/api";
import { clearLastActiveAnalysisId, isActiveAnalysisStatus, setLastActiveAnalysisId, setLastAnalysisId } from "../../lib/analysis-state";
import { AppShell, ErrorState, LoadingState, StatusPill } from "../../components/shell";

export default function AnalysisDetail() {
  const params = useParams();
  const queryClient = useQueryClient();
  const analysis = createQuery(() => ({
    queryKey: ["analysis", params.id],
    queryFn: () => api<AnalysisRun>(`/analyses/${params.id}`),
    refetchInterval: (query) => isActiveAnalysisStatus(query.state.data?.status) ? 1_500 : false,
  }));

  createEffect(() => {
    const run = analysis.data;
    if (!run) return;
    setLastAnalysisId(run.id);
    if (isActiveAnalysisStatus(run.status)) {
      setLastActiveAnalysisId(run.id);
      return;
    }
    clearLastActiveAnalysisId(run.id);
    void queryClient.invalidateQueries({ queryKey: ["analyses"] });
  });

  return (
    <AppShell eyebrow="Analysis file" title="Impact report" description="A working record of what changes, what conflicts, and why.">
      <Switch>
        <Match when={analysis.isPending}><LoadingState label="Opening analysis file..." /></Match>
        <Match when={analysis.isError}><ErrorState error={analysis.error} /></Match>
        <Match when={analysis.data}>
          {(run) => (
            <>
              <section class="analysis-masthead">
                <div>
                  <StatusPill status={run().status} />
                  <h2>{run().requirement}</h2>
                  <Show when={run().mode === "delivery" && (run().deliveryReference || run().sourceGroup)}>
                    <p class="masthead-note">Bundle: {run().deliveryReference?.title ?? run().sourceGroup?.name}</p>
                  </Show>
                </div>
                <div class="quality-score">
                  <span>{run().mode === "delivery" ? "Analysis mode" : "Requirement quality"}</span>
                  <strong>{run().mode === "delivery" ? "DLV" : run().quality.score}</strong>
                  <small>{run().mode === "delivery" ? "delivery bundle" : "out of 100"}</small>
                </div>
              </section>

              <Show when={run().mode === "requirement" && run().quality.issues.length}>
                <div class="quality-note">
                  <strong>Questions before delivery</strong>
                  <p>{run().quality.issues.join(" ")}</p>
                </div>
              </Show>

              <Show when={isActiveAnalysisStatus(run().status)}>
                <LoadingState label={`${run().status.charAt(0).toUpperCase()}${run().status.slice(1)} product knowledge...`} />
              </Show>
              <Show when={run().status === "failed"}>
                <div class="state-panel error" role="alert"><strong>Analysis failed.</strong><span>{run().error}</span></div>
              </Show>
              <Show when={run().result}>
                {(result) => (
                  run().mode === "delivery"
                    ? <DeliveryReport result={result() as DeliveryAnalysisResult} />
                    : <RequirementReport result={result() as ImpactAnalysisResult} />
                )}
              </Show>
              <div class="report-actions"><A href="/analyze?fresh=1" class="button button-primary">{run().mode === "delivery" ? "Analyze another delivery" : "Analyze another requirement"}</A></div>
            </>
          )}
        </Match>
      </Switch>
    </AppShell>
  );
}

function RequirementReport(props: { result: ImpactAnalysisResult }) {
  return (
    <div class="report-layout">
      <article class="report-paper">
        <section class="report-section summary-section">
          <p class="eyebrow">Editorial summary</p>
          <h2>{props.result.summary}</h2>
        </section>
        <section class="report-section">
          <div class="report-heading"><span>01</span><h3>Affected knowledge</h3></div>
          <For each={props.result.affectedKnowledge} fallback={<p class="muted">No affected knowledge was supported by retrieved evidence.</p>}>
            {(item) => (
              <div class="finding">
                <h4>{item.knowledge}</h4>
                <p>{item.impact}</p>
                <EvidenceLinks ids={item.evidenceChunkIds} />
              </div>
            )}
          </For>
        </section>
        <section class="report-section">
          <div class="report-heading"><span>02</span><h3>Possible conflicts</h3></div>
          <For each={props.result.possibleConflicts} fallback={<p class="muted">No evidence-backed conflicts were identified.</p>}>
            {(item) => (
              <div class="finding conflict">
                <span class={`severity severity-${item.severity}`}>{item.severity}</span>
                <p>{item.conflict}</p>
                <EvidenceLinks ids={item.evidenceChunkIds} />
              </div>
            )}
          </For>
        </section>
        <section class="report-section split-section">
          <div>
            <div class="report-heading"><span>03</span><h3>Missing questions</h3></div>
            <ul><For each={props.result.missingQuestions}>{(item) => <li>{item}</li>}</For></ul>
          </div>
          <div>
            <div class="report-heading"><span>04</span><h3>Suggested tests</h3></div>
            <ul><For each={props.result.suggestedTests}>{(item) => <li>{item}</li>}</For></ul>
          </div>
        </section>
      </article>

      <EvidenceRail evidence={props.result.evidence} />
    </div>
  );
}

function DeliveryReport(props: { result: DeliveryAnalysisResult }) {
  if (!("documents" in props.result)) {
    return <LegacyDeliveryReport result={props.result} />;
  }

  return (
    <div class="report-layout">
      <article class="report-paper">
        <For each={props.result.documents}>
          {(document, index) => (
            <section class="report-section">
              {(() => {
                const evidencePrefix = document.inputDocument.outlineDocumentId
                  ?? document.inputDocument.sourceDocumentId
                  ?? `doc-${index() + 1}`;
                return (
                  <>
              <div class="report-heading"><span>{String(index() + 1).padStart(2, "0")}</span><h3>{document.inputDocument.title}</h3></div>
              <p class="masthead-note">{document.inputDocument.outlinePath.join(" / ")}</p>
              <div class="finding">
                <p>{document.summary}</p>
              </div>
              <div class="split-section">
                <div>
                  <div class="report-heading"><span>A</span><h3>Impacted areas</h3></div>
                  <For each={document.impactedAreas} fallback={<p class="muted">No clear impacted areas were supported by retrieved evidence.</p>}>
                    {(item) => (
                      <div class="finding">
                        <h4>{item.area}</h4>
                        <p>{item.impact}</p>
                        <EvidenceLinks ids={item.evidenceChunkIds} prefix={evidencePrefix} />
                      </div>
                    )}
                  </For>
                </div>
                <div>
                  <div class="report-heading"><span>B</span><h3>Dependencies</h3></div>
                  <For each={document.dependencies} fallback={<p class="muted">No dependent knowledge areas were identified.</p>}>
                    {(item) => (
                      <div class="finding">
                        <h4>{item.dependency}</h4>
                        <p>{item.rationale}</p>
                        <EvidenceLinks ids={item.evidenceChunkIds} prefix={evidencePrefix} />
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div class="split-section">
                <div>
                  <div class="report-heading"><span>C</span><h3>Possible conflicts</h3></div>
                  <For each={document.possibleConflicts} fallback={<p class="muted">No evidence-backed conflicts were identified.</p>}>
                    {(item) => (
                      <div class="finding conflict">
                        <span class={`severity severity-${item.severity}`}>{item.severity}</span>
                        <p>{item.conflict}</p>
                        <EvidenceLinks ids={item.evidenceChunkIds} prefix={evidencePrefix} />
                      </div>
                    )}
                  </For>
                </div>
                <div>
                  <div class="report-heading"><span>D</span><h3>Missing clarifications</h3></div>
                  <ul><For each={document.missingClarifications}>{(item) => <li>{item}</li>}</For></ul>
                </div>
              </div>
              <div class="report-section">
                <div class="report-heading"><span>E</span><h3>Evidence for this doc</h3></div>
                <DocEvidenceList evidence={document.evidence} prefix={evidencePrefix} />
              </div>
                  </>
                );
              })()}
            </section>
          )}
        </For>
      </article>
    </div>
  );
}

function LegacyDeliveryReport(props: { result: LegacyDeliveryAnalysisResult }) {
  return (
    <div class="report-layout">
      <article class="report-paper">
        <section class="report-section summary-section">
          <p class="eyebrow">Delivery summary</p>
          <h2>{props.result.summary}</h2>
        </section>
        <section class="report-section">
          <div class="report-heading"><span>01</span><h3>Input bundle</h3></div>
          <div class="bundle-list">
            <For each={props.result.inputDocuments}>
              {(item) => (
                <div class="finding">
                  <h4>{item.title}</h4>
                  <p>{item.outlinePath.join(" / ")}</p>
                </div>
              )}
            </For>
          </div>
        </section>
        <section class="report-section">
          <div class="report-heading"><span>02</span><h3>Impacted areas</h3></div>
          <For each={props.result.impactedAreas} fallback={<p class="muted">No cross-source impacted areas were supported by retrieved evidence.</p>}>
            {(item) => (
              <div class="finding">
                <h4>{item.area}</h4>
                <p>{item.impact}</p>
                <EvidenceLinks ids={item.evidenceChunkIds} />
              </div>
            )}
          </For>
        </section>
        <section class="report-section">
          <div class="report-heading"><span>03</span><h3>Possible conflicts</h3></div>
          <For each={props.result.possibleConflicts} fallback={<p class="muted">No evidence-backed conflicts were identified.</p>}>
            {(item) => (
              <div class="finding conflict">
                <span class={`severity severity-${item.severity}`}>{item.severity}</span>
                <p>{item.conflict}</p>
                <EvidenceLinks ids={item.evidenceChunkIds} />
              </div>
            )}
          </For>
        </section>
        <section class="report-section split-section">
          <div>
            <div class="report-heading"><span>04</span><h3>Dependencies</h3></div>
            <For each={props.result.dependencies} fallback={<p class="muted">No dependent knowledge areas were identified.</p>}>
              {(item) => (
                <div class="finding">
                  <h4>{item.dependency}</h4>
                  <p>{item.rationale}</p>
                  <EvidenceLinks ids={item.evidenceChunkIds} />
                </div>
              )}
            </For>
          </div>
          <div>
            <div class="report-heading"><span>05</span><h3>Missing clarifications</h3></div>
            <ul><For each={props.result.missingClarifications}>{(item) => <li>{item}</li>}</For></ul>
          </div>
        </section>
      </article>

      <EvidenceRail evidence={props.result.evidence} />
    </div>
  );
}

function EvidenceRail(props: { evidence: Array<{ chunkId: string; title: string; section: string | null; excerpt: string }> }) {
  return (
    <aside class="evidence-rail" aria-label="Evidence">
      <div class="evidence-header"><p class="eyebrow">Evidence rail</p><span>{props.evidence.length} cited</span></div>
      <For each={props.evidence} fallback={<p class="muted">No evidence was available.</p>}>
        {(item, index) => (
          <article class="evidence-card" id={`evidence-${item.chunkId}`}>
            <span class="evidence-index">{String(index() + 1).padStart(2, "0")}</span>
            <h3>{item.title}</h3>
            <Show when={item.section}><p class="evidence-section">{item.section}</p></Show>
            <blockquote>{item.excerpt}</blockquote>
          </article>
        )}
      </For>
    </aside>
  );
}

function DocEvidenceList(props: { evidence: Array<{ chunkId: string; title: string; section: string | null; excerpt: string }>; prefix: string }) {
  return (
    <div class="bundle-list">
      <For each={props.evidence} fallback={<p class="muted">No evidence was available for this document.</p>}>
        {(item, index) => (
          <article class="finding" id={`evidence-${props.prefix}-${item.chunkId}`}>
            <h4>Evidence {index() + 1}: {item.title}</h4>
            <Show when={item.section}><p class="evidence-section">{item.section}</p></Show>
            <p>{item.excerpt}</p>
          </article>
        )}
      </For>
    </div>
  );
}

function EvidenceLinks(props: { ids: string[]; prefix?: string }) {
  return (
    <div class="evidence-links">
      <For each={props.ids}>{(id, index) => <a href={`#evidence-${props.prefix ? `${props.prefix}-` : ""}${id}`}>Evidence {index() + 1}</a>}</For>
    </div>
  );
}
