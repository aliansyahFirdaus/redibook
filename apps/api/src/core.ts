import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  PipeTransform,
} from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { map, type Observable } from "rxjs";
import type { ZodType } from "zod";

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    request.requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", request.requestId);
    return next.handle().pipe(map((value) => value));
  }
}

@Catch()
export class StandardErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const objectPayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};

    response.status(status).json({
      error: {
        code: typeof objectPayload.code === "string" ? objectPayload.code : status === 500 ? "INTERNAL_ERROR" : "HTTP_ERROR",
        message: typeof objectPayload.message === "string"
          ? objectPayload.message
          : error instanceof Error ? error.message : "Unexpected error",
        ...(objectPayload.details ? { details: objectPayload.details } : {}),
      },
      requestId: request.requestId ?? randomUUID(),
    });
  }
}
