import { createHash } from "node:crypto";
import {
  modelDeliveryResultSchema,
  modelImpactResultSchema,
  qualityResultSchema,
  type ModelDeliveryResult,
  type ModelImpactResult,
  type QualityResult,
} from "@redibook/contracts";
import type { RetrievedChunk } from "@redibook/retrieval";
import { z } from "zod";

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export type DeliveryBundleDocument = {
  title: string;
  outlinePath: string[];
  excerpt: string;
};

export type DeliveryAnalysisInput = {
  groupName: string;
  prompt: string | null;
  document: DeliveryBundleDocument;
};

export interface ReasoningProvider {
  readonly name: string;
  readonly model: string;
  analyze(requirement: string, evidence: RetrievedChunk[]): Promise<ModelImpactResult>;
  analyzeDelivery(input: DeliveryAnalysisInput, evidence: RetrievedChunk[]): Promise<ModelDeliveryResult>;
}

export function checkRequirementQuality(requirement: string): QualityResult {
  const text = requirement.trim();
  const checks = {
    actor: /\b(user|admin|customer|employee|manager|system|service|team|agent)\b/i.test(text),
    behavior: /\b(must|should|shall|can|will|when|allow|prevent|calculate|display|send|lock|complete|change)\b/i.test(text),
    conditions: /\b(if|when|after|before|unless|while|given)\b/i.test(text),
    constraints: /\b(within|at least|at most|exactly|percent|%|seconds?|minutes?|days?|five|5)\b/i.test(text),
    acceptanceCriteria: /\b(acceptance|verify|test|expected|then|success|fails?|completed?)\b/i.test(text),
  };
  const labels = Object.keys(checks) as Array<keyof typeof checks>;
  const missingElements = labels.filter((label) => !checks[label]);
  return qualityResultSchema.parse({
    score: Math.round(((labels.length - missingElements.length) / labels.length) * 100),
    missingElements,
    issues: missingElements.map((element) => `Requirement does not clearly state ${element}.`),
  });
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "hashed-token-1536";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashEmbedding);
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  ) {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: 1536 }),
    });
    if (!response.ok) throw new Error(`OpenAI embeddings failed with ${response.status}`);
    const body = z.object({
      data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()).length(1536) })),
    }).parse(await response.json());
    return body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openrouter";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    private readonly baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  ) {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: 1536,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter embeddings failed with ${response.status}`);
    const body = z.object({
      data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()).length(1536) })),
    }).parse(await response.json());
    return body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

export class MockReasoningProvider implements ReasoningProvider {
  readonly name = "mock";
  readonly model = "deterministic-impact-v1";

  async analyze(requirement: string, evidence: RetrievedChunk[]): Promise<ModelImpactResult> {
    const top = evidence.slice(0, 3);
    if (!top.length) {
      return {
        summary: "No indexed knowledge was retrieved for this requirement.",
        affectedKnowledge: [],
        possibleConflicts: [],
        missingQuestions: ["Which existing product behavior should this requirement change?"],
        suggestedTests: ["Index relevant product documentation before rerunning analysis."],
        evidenceChunkIds: [],
      };
    }
    const ids = top.map((item) => item.chunkId);
    return modelImpactResultSchema.parse({
      summary: `The requirement may change ${top.map((item) => item.section ?? item.title).join(", ")}.`,
      affectedKnowledge: top.map((item) => ({
        knowledge: item.section ?? item.title,
        impact: `Review this knowledge against the requested behavior: ${requirement.slice(0, 180)}`,
        evidenceChunkIds: [item.chunkId],
      })),
      possibleConflicts: top[0] ? [{
        conflict: `Existing guidance in ${top[0].section ?? top[0].title} may need revision.`,
        severity: "medium",
        evidenceChunkIds: [top[0].chunkId],
      }] : [],
      missingQuestions: ["What rollout and backward-compatibility constraints apply?"],
      suggestedTests: [
        "Verify the new behavior under the stated condition.",
        "Verify the previous behavior remains unchanged outside that condition.",
      ],
      evidenceChunkIds: ids,
    });
  }

  async analyzeDelivery(input: DeliveryAnalysisInput, evidence: RetrievedChunk[]): Promise<ModelDeliveryResult> {
    const top = evidence.slice(0, 4);
    if (!top.length) {
      return modelDeliveryResultSchema.parse({
        summary: `No clear cross-source impact was retrieved for ${input.document.title}.`,
        impactedAreas: [],
        possibleConflicts: [],
        dependencies: [],
        missingClarifications: ["No clear cross-source impact was found yet. Confirm whether this document should affect product knowledge outside the sprint scope."],
        evidenceChunkIds: [],
      });
    }
    const ids = top.map((item) => item.chunkId);
    return modelDeliveryResultSchema.parse({
      summary: `${input.document.title} likely affects ${top.map((item) => item.section ?? item.title).join(", ")}.`,
      impactedAreas: top.slice(0, 3).map((item) => ({
        area: item.section ?? item.title,
        impact: `Review how ${input.document.title} changes this knowledge area.`,
        evidenceChunkIds: [item.chunkId],
      })),
      possibleConflicts: top[0] ? [{
        conflict: `${top[0].section ?? top[0].title} may now conflict with ${input.document.title}.`,
        severity: "medium",
        evidenceChunkIds: [top[0].chunkId],
      }] : [],
      dependencies: top[1] ? [{
        dependency: top[1].section ?? top[1].title,
        rationale: "This area should be reviewed alongside the sprint deliverables.",
        evidenceChunkIds: [top[1].chunkId],
      }] : [],
      missingClarifications: input.prompt
        ? ["Confirm whether the prompt should prioritize product impact, documentation changes, or rollout risk."]
        : ["Add a short prompt if you need the analysis framed around a specific product question."],
      evidenceChunkIds: ids,
    });
  }
}

export class AnthropicReasoningProvider implements ReasoningProvider {
  readonly name = "anthropic";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  ) {
    this.model = model;
  }

  async analyze(requirement: string, evidence: RetrievedChunk[]): Promise<ModelImpactResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 3000,
        system: [
          "Analyze product requirement impact using only the supplied evidence.",
          "Every affected item and conflict needs at least one supplied chunk ID.",
          "Turn unsupported claims into missingQuestions.",
        ].join(" "),
        messages: [{
          role: "user",
          content: JSON.stringify({
            requirement,
            evidence: evidence.map(({ chunkId, title, section, content }) => ({
              chunkId, title, section, content,
            })),
          }),
        }],
        output_config: {
          format: {
            type: "json_schema",
            name: "impact_analysis",
            schema: z.toJSONSchema(modelImpactResultSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Anthropic analysis failed with ${response.status}`);
    const body = z.object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    }).parse(await response.json());
    const text = body.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no structured output");
    return modelImpactResultSchema.parse(JSON.parse(text));
  }

  async analyzeDelivery(input: DeliveryAnalysisInput, evidence: RetrievedChunk[]): Promise<ModelDeliveryResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 3000,
        system: [
          "Analyze the impact of a single delivery document against the supplied external evidence.",
          "The delivery document is the change input, not the evidence to cite.",
          "Use only the supplied evidence chunk IDs for impacted areas, conflicts, and dependencies.",
          "Turn unsupported claims into missingClarifications.",
        ].join(" "),
        messages: [{
          role: "user",
          content: JSON.stringify({
            groupName: input.groupName,
            prompt: input.prompt,
            document: input.document,
            evidence: evidence.map(({ chunkId, title, section, content }) => ({
              chunkId, title, section, content,
            })),
          }),
        }],
        output_config: {
          format: {
            type: "json_schema",
            name: "delivery_analysis",
            schema: z.toJSONSchema(modelDeliveryResultSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Anthropic delivery analysis failed with ${response.status}`);
    const body = z.object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    }).parse(await response.json());
    const text = body.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no structured output");
    return modelDeliveryResultSchema.parse(JSON.parse(text));
  }
}

export class OpenRouterReasoningProvider implements ReasoningProvider {
  readonly name = "openrouter";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = process.env.OPENROUTER_REASONING_MODEL ?? "anthropic/claude-sonnet-4",
    private readonly baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  ) {
    this.model = model;
  }

  async analyze(requirement: string, evidence: RetrievedChunk[]): Promise<ModelImpactResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: [
              "Analyze product requirement impact using only the supplied evidence.",
              "Every affected item and conflict needs at least one supplied chunk ID.",
              "Turn unsupported claims into missingQuestions.",
              "Return valid JSON matching the supplied schema.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              requirement,
              evidence: evidence.map(({ chunkId, title, section, content }) => ({
                chunkId, title, section, content,
              })),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "impact_analysis",
            strict: true,
            schema: z.toJSONSchema(modelImpactResultSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter analysis failed with ${response.status}`);
    const body = z.object({
      choices: z.array(z.object({
        message: z.object({
          content: z.string().optional(),
        }),
      })).min(1),
    }).parse(await response.json());
    const text = body.choices[0]?.message.content;
    if (!text) throw new Error("OpenRouter returned no structured output");
    return modelImpactResultSchema.parse(JSON.parse(text));
  }

  async analyzeDelivery(input: DeliveryAnalysisInput, evidence: RetrievedChunk[]): Promise<ModelDeliveryResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: [
              "Analyze the impact of a single delivery document against the supplied external evidence.",
              "The delivery document is the change input, not the evidence to cite.",
              "Use only the supplied evidence chunk IDs for impacted areas, conflicts, and dependencies.",
              "Turn unsupported claims into missingClarifications.",
              "Return valid JSON matching the supplied schema.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              groupName: input.groupName,
              prompt: input.prompt,
              document: input.document,
              evidence: evidence.map(({ chunkId, title, section, content }) => ({
                chunkId, title, section, content,
              })),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "delivery_analysis",
            strict: true,
            schema: z.toJSONSchema(modelDeliveryResultSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter delivery analysis failed with ${response.status}`);
    const body = z.object({
      choices: z.array(z.object({
        message: z.object({
          content: z.string().optional(),
        }),
      })).min(1),
    }).parse(await response.json());
    const text = body.choices[0]?.message.content;
    if (!text) throw new Error("OpenRouter returned no structured output");
    return modelDeliveryResultSchema.parse(JSON.parse(text));
  }
}

export function selectEmbeddingProvider(environment = process.env): EmbeddingProvider {
  return environment.OPENROUTER_API_KEY
    ? new OpenRouterEmbeddingProvider(environment.OPENROUTER_API_KEY, environment.OPENROUTER_EMBEDDING_MODEL, environment.OPENROUTER_BASE_URL)
    : environment.OPENAI_API_KEY
    ? new OpenAIEmbeddingProvider(environment.OPENAI_API_KEY, environment.OPENAI_EMBEDDING_MODEL)
    : new MockEmbeddingProvider();
}

export function selectReasoningProvider(environment = process.env): ReasoningProvider {
  return environment.OPENROUTER_API_KEY
    ? new OpenRouterReasoningProvider(environment.OPENROUTER_API_KEY, environment.OPENROUTER_REASONING_MODEL, environment.OPENROUTER_BASE_URL)
    : environment.ANTHROPIC_API_KEY
    ? new AnthropicReasoningProvider(environment.ANTHROPIC_API_KEY, environment.ANTHROPIC_MODEL)
    : new MockReasoningProvider();
}

function hashEmbedding(text: string): number[] {
  const vector = new Array<number>(1536).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt16BE(0) % vector.length;
    vector[index] = vector[index]! + (digest[2]! % 2 === 0 ? 1 : -1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}
