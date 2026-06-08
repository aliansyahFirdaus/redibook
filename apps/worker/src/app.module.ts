import { BullModule } from "@nestjs/bullmq";
import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@redibook/database";
import { selectEmbeddingProvider, selectReasoningProvider } from "@redibook/ai";
import {
  ANALYSIS_QUEUE,
  DOCUMENT_QUEUE,
  defaultJobOptions,
} from "@redibook/queue";
import { AnalysisProcessor } from "./analysis.processor.js";
import { DocumentProcessor } from "./document.processor.js";
import { DATABASE, EMBEDDING_PROVIDER, REASONING_PROVIDER } from "./tokens.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.end();
  }
}

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        username: redisUrl.username || undefined,
        password: redisUrl.password || undefined,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions,
    }),
    BullModule.registerQueue({ name: DOCUMENT_QUEUE }, { name: ANALYSIS_QUEUE }),
  ],
  providers: [
    { provide: DATABASE, useFactory: createDatabase },
    { provide: EMBEDDING_PROVIDER, useFactory: selectEmbeddingProvider },
    { provide: REASONING_PROVIDER, useFactory: selectReasoningProvider },
    DatabaseShutdown,
    DocumentProcessor,
    AnalysisProcessor,
  ],
})
export class AppModule {}
