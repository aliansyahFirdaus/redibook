import { Controller, Get, Inject, Module } from "@nestjs/common";
import { selectEmbeddingProvider, selectReasoningProvider } from "@redibook/ai";
import type { Database } from "@redibook/database";
import { DATABASE, REDIS_CONNECTION } from "./infrastructure.module.js";

@Controller("health")
class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(REDIS_CONNECTION) private readonly redis: { ping(): Promise<string> },
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      this.database.query("SELECT 1").then(() => "ready"),
      this.redis.ping().then((value) => value === "PONG" ? "ready" : "unavailable"),
    ]);
    const embedding = selectEmbeddingProvider();
    const reasoning = selectReasoningProvider();
    return {
      status: database === "ready" && redis === "ready" ? "ready" : "degraded",
      database,
      redis,
      ai: {
        embedding: { provider: embedding.name, model: embedding.model },
        reasoning: { provider: reasoning.name, model: reasoning.model },
      },
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
