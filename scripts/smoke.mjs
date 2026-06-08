const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001/api/v1";

const source = await request("/sources/manual", {
  method: "POST",
  body: JSON.stringify({
    title: "Authentication policy",
    markdown: [
      "# Authentication",
      "",
      "## Login lockout",
      "",
      "Accounts currently lock after three failed login attempts within ten minutes.",
      "An administrator must unlock a locked account before the user can try again.",
    ].join("\n"),
  }),
});

await waitFor(async () => {
  const response = await request("/sources");
  const created = response.items.find((item) => item.id === source.id);
  if (created?.indexStatus === "failed") throw new Error(created.indexError ?? "Source indexing failed");
  return created?.indexStatus === "ready" ? created : null;
}, "source indexing");

await request(`/sources/${source.id}/index`, { method: "POST" });
await waitFor(async () => {
  const response = await request("/sources");
  const created = response.items.find((item) => item.id === source.id);
  if (created?.indexStatus === "failed") throw new Error(created.indexError ?? "Source re-indexing failed");
  return created?.indexStatus === "ready" ? created : null;
}, "source re-indexing");

const run = await request("/analyses", {
  method: "POST",
  body: JSON.stringify({
    requirement: "When a user fails login five times within ten minutes, the system must lock the account. Verify the fifth failure rejects access.",
  }),
});

const completed = await waitFor(async () => {
  const response = await request(`/analyses/${run.id}`);
  if (response.status === "failed") throw new Error(response.error ?? "Analysis failed");
  return response.status === "completed" ? response : null;
}, "analysis completion");

const evidenceIds = new Set(completed.result.evidence.map((item) => item.chunkId));
const claimIds = [
  ...completed.result.affectedKnowledge.flatMap((item) => item.evidenceChunkIds),
  ...completed.result.possibleConflicts.flatMap((item) => item.evidenceChunkIds),
];
if (!claimIds.length || claimIds.some((id) => !evidenceIds.has(id))) {
  throw new Error("Completed analysis contains unsupported evidence references");
}

console.log(JSON.stringify({
  health: await request("/health"),
  sourceId: source.id,
  runId: run.id,
  evidenceCount: evidenceIds.size,
  provider: completed.provider,
  model: completed.model,
}, null, 2));

async function request(path, init) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  return body;
}

async function waitFor(check, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
