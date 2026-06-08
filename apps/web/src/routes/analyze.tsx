import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { api, type AnalysisRun } from "../lib/api";
import {
  clearLastActiveAnalysisId,
  clearLastAnalysisId,
  findActiveAnalysis,
  getLastAnalysisId,
  isActiveAnalysisStatus,
  setLastActiveAnalysisId,
  setLastAnalysisId,
} from "../lib/analysis-state";
import { AppShell, StatusPill } from "../components/shell";

type AnalyzeMode = "requirement" | "delivery";

export default function Analyze() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [analysisMode, setAnalysisMode] = createSignal<AnalyzeMode>("requirement");
  const [requirement, setRequirement] = createSignal("");
  const [deliveryReference, setDeliveryReference] = createSignal("");
  const [deliveryPrompt, setDeliveryPrompt] = createSignal("");
  const [resumeAnalysisId, setResumeAnalysisId] = createSignal<string | null>(null);
  const [storedAnalysis, setStoredAnalysis] = createSignal<AnalysisRun | null>(null);
  const isFreshMode = () => searchParams.fresh === "1";
  const analyses = createQuery(() => ({
    queryKey: ["analyses"],
    queryFn: () => api<{ items: AnalysisRun[] }>("/analyses"),
    refetchInterval: (query) => findActiveAnalysis(query.state.data?.items) ? 1_500 : false,
  }));
  const activeAnalysis = () => {
    if (isFreshMode()) return null;
    if (isActiveAnalysisStatus(storedAnalysis()?.status)) return storedAnalysis();
    return findActiveAnalysis(analyses.data?.items);
  };
  const mutation = createMutation(() => ({
    mutationFn: () => analysisMode() === "delivery"
      ? api<{ id: string }>("/analyses", {
        method: "POST",
        body: JSON.stringify({
          mode: "delivery",
          deliveryUrl: deliveryReference().trim(),
          prompt: deliveryPrompt().trim() || undefined,
        }),
      })
      : api<{ id: string }>("/analyses", {
        method: "POST",
        body: JSON.stringify({ requirement: requirement() }),
      }),
    onSuccess: async (run) => {
      setLastAnalysisId(run.id);
      setLastActiveAnalysisId(run.id);
      setResumeAnalysisId(run.id);
      await queryClient.invalidateQueries({ queryKey: ["analyses"] });
      navigate(`/analysis/${run.id}`);
    },
  }));

  onMount(() => {
    if (isFreshMode()) {
      clearLastActiveAnalysisId();
      clearLastAnalysisId();
      setStoredAnalysis(null);
      setResumeAnalysisId(null);
      void navigate("/analyze", { replace: true });
      return;
    }

    const id = getLastAnalysisId();
    if (!id) return;
    setResumeAnalysisId(id);

    void api<AnalysisRun>(`/analyses/${id}`)
      .then((run) => {
        setLastAnalysisId(run.id);
        if (isActiveAnalysisStatus(run.status)) {
          setLastActiveAnalysisId(run.id);
          setStoredAnalysis(run);
          return;
        }

        clearLastActiveAnalysisId(run.id);
        setStoredAnalysis(null);
        void navigate(`/analysis/${run.id}`, { replace: true });
      })
      .catch(() => {
        clearLastActiveAnalysisId(id);
        clearLastAnalysisId(id);
        setStoredAnalysis(null);
        setResumeAnalysisId(null);
      });
  });

  createEffect(() => {
    if (isFreshMode()) return;

    const resumeId = resumeAnalysisId();
    if (!resumeId) return;
    const run = analyses.data?.items.find((item) => item.id === resumeId);
    if (!run) return;

    setLastAnalysisId(run.id);
    if (isActiveAnalysisStatus(run.status)) {
      setLastActiveAnalysisId(run.id);
      setStoredAnalysis(run);
      return;
    }

    clearLastActiveAnalysisId(run.id);
    setStoredAnalysis(null);
    void navigate(`/analysis/${run.id}`, { replace: true });
  });

  createEffect(() => {
    const run = storedAnalysis();
    if (!run || isActiveAnalysisStatus(run.status)) return;
    clearLastActiveAnalysisId(run.id);
  });

  return (
    <AppShell
      eyebrow="Impact analyzer"
      title="What is changing?"
    >
      <Show
        when={activeAnalysis()}
        fallback={(
          <AnalysisForm
            analysisMode={analysisMode()}
            setAnalysisMode={setAnalysisMode}
            requirement={requirement()}
            setRequirement={setRequirement}
            deliveryReference={deliveryReference()}
            setDeliveryReference={setDeliveryReference}
            deliveryPrompt={deliveryPrompt()}
            setDeliveryPrompt={setDeliveryPrompt}
            mutation={mutation}
          />
        )}
      >
        {(run) => (
          <section class="active-analysis-panel">
            <div>
              <StatusPill status={run().status} />
              <h2>Analysis is still running.</h2>
              <p>{run().requirement}</p>
            </div>
            <A href={`/analysis/${run().id}`} class="button button-primary">Open active report</A>
          </section>
        )}
      </Show>
      <MethodStrip />
    </AppShell>
  );
}

function AnalysisForm(props: {
  analysisMode: AnalyzeMode;
  setAnalysisMode: (value: AnalyzeMode) => void;
  requirement: string;
  setRequirement: (value: string) => void;
  deliveryReference: string;
  setDeliveryReference: (value: string) => void;
  deliveryPrompt: string;
  setDeliveryPrompt: (value: string) => void;
  mutation: ReturnType<typeof createMutation<{ id: string }, Error, void, unknown>>;
}) {
  const deliveryReady = () => isValidOutlineDocumentUrl(props.deliveryReference);

  return (
    <section class="analyzer-canvas">
      <div class="segmented-control analyzer-modes" role="tablist" aria-label="Analysis modes">
        <button type="button" classList={{ active: props.analysisMode === "requirement" }} onClick={() => props.setAnalysisMode("requirement")}>Ask</button>
        <button type="button" classList={{ active: props.analysisMode === "delivery" }} onClick={() => props.setAnalysisMode("delivery")}>Delivery</button>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); props.mutation.mutate(); }}>
        <Show
          when={props.analysisMode === "delivery"}
          fallback={(
            <textarea
              id="requirement"
              class="requirement-input"
              rows="12"
              minlength="10"
              value={props.requirement}
              onInput={(event) => props.setRequirement(event.currentTarget.value)}
              placeholder="When [actor] does [behavior] under [condition], the product must..."
              required
            />
          )}
        >
          <div class="delivery-form">
            <div class="delivery-grid">
              <label>
                <span>Sprint bundle</span>
                <input
                  value={props.deliveryReference}
                  onInput={(event) => props.setDeliveryReference(event.currentTarget.value)}
                  placeholder="Paste an Outline sprint URL"
                />
              </label>
            </div>
            <Show when={props.deliveryReference.trim() && !deliveryReady()}>
              <p class="form-error" role="alert">Paste an Outline document URL for the sprint bundle.</p>
            </Show>
            <label class="delivery-prompt-field">
              <span>Optional question</span>
              <textarea
                rows="6"
                value={props.deliveryPrompt}
                onInput={(event) => props.setDeliveryPrompt(event.currentTarget.value)}
                placeholder="Focus on product impact, rollout risk, dependency changes, or another specific question."
              />
            </label>
          </div>
        </Show>

        <div class="analyzer-footer">
          <p><span class="status-dot" aria-hidden="true" />Quality checks guide freeform questions. Delivery analysis compares the sprint bundle against the rest of the knowledge base.</p>
          <button
            class="button button-primary"
            type="submit"
            disabled={
              props.mutation.isPending
              || (props.analysisMode === "requirement" && props.requirement.trim().length < 10)
              || (props.analysisMode === "delivery" && !deliveryReady())
            }
          >
            {props.mutation.isPending ? "Submitting analysis..." : props.analysisMode === "delivery" ? "Analyze delivery" : "Analyze impact"}
          </button>
        </div>
        <Show when={props.mutation.isError}><p class="form-error" role="alert">{props.mutation.error?.message}</p></Show>
      </form>
    </section>
  );
}

function MethodStrip() {
  return (
    <section class="method-strip" aria-label="Analysis method">
      <div><span>01</span><strong>Quality check</strong><p>Find missing actors, conditions, and acceptance criteria.</p></div>
      <div><span>02</span><strong>Hybrid retrieval</strong><p>Blend lexical and semantic evidence from indexed sources.</p></div>
      <div><span>03</span><strong>Evidence validation</strong><p>Reject claims that cite knowledge the model never received.</p></div>
    </section>
  );
}

function isValidOutlineDocumentUrl(value: string) {
  try {
    return new URL(value.trim()).pathname.split("/").filter(Boolean).includes("doc");
  } catch {
    return false;
  }
}
