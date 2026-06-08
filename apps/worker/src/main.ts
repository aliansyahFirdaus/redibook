import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { initializeObservability, shutdownObservability } from "@redibook/observability";
import { AppModule } from "./app.module.js";

await initializeObservability();
const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks();

const shutdown = async () => {
  await app.close();
  await shutdownObservability();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
