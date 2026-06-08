import { Module } from "@nestjs/common";
import { AnalysesModule } from "./analyses.module.js";
import { HealthModule } from "./health.module.js";
import { InfrastructureModule } from "./infrastructure.module.js";
import { SourcesModule } from "./sources.module.js";

@Module({
  imports: [InfrastructureModule, HealthModule, SourcesModule, AnalysesModule],
})
export class AppModule {}
