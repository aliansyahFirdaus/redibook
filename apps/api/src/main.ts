import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { initializeObservability, shutdownObservability } from "@redibook/observability";
import { AppModule } from "./app.module.js";
import { RequestIdInterceptor, StandardErrorFilter } from "./core.js";

await initializeObservability();
const app = await NestFactory.create(AppModule, { cors: true });
app.setGlobalPrefix("api/v1");
app.useGlobalInterceptors(new RequestIdInterceptor());
app.useGlobalFilters(new StandardErrorFilter());
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");

process.once("SIGTERM", async () => {
  await app.close();
  await shutdownObservability();
});
