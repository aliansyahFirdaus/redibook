import { Global, Inject, Injectable, Module, OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@redibook/database";
import { createQueues } from "@redibook/queue";
import type { Queue } from "bullmq";

export const DATABASE = Symbol("DATABASE");
export const DOCUMENTS_QUEUE = Symbol("DOCUMENTS_QUEUE");
export const ANALYSES_QUEUE = Symbol("ANALYSES_QUEUE");
export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");

@Injectable()
class InfrastructureShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENTS_QUEUE) private readonly documents: Queue,
    @Inject(ANALYSES_QUEUE) private readonly analyses: Queue,
    @Inject(REDIS_CONNECTION) private readonly redis: { quit(): Promise<unknown> },
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.documents.close(), this.analyses.close()]);
    await this.redis.quit();
    await this.database.end();
  }
}

const queues = createQueues();

@Global()
@Module({
  providers: [
    { provide: DATABASE, useFactory: createDatabase },
    { provide: DOCUMENTS_QUEUE, useValue: queues.documents },
    { provide: ANALYSES_QUEUE, useValue: queues.analyses },
    { provide: REDIS_CONNECTION, useValue: queues.connection },
    InfrastructureShutdown,
  ],
  exports: [DATABASE, DOCUMENTS_QUEUE, ANALYSES_QUEUE, REDIS_CONNECTION],
})
export class InfrastructureModule {}
