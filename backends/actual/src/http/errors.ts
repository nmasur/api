import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export interface ErrorResponseBody {
  error: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key') {
    super(401, 'unauthorized', message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Content-Type must be application/json') {
    super(415, 'unsupported_media_type', message);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'upstream_error', message, details);
  }
}

export function handleFastifyError(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: error.errorCode,
      message: error.message,
    };
    if (error.details !== undefined) {
      body.details = error.details;
    }
    reply.status(error.statusCode).send(body);
    return;
  }

  const fastifyError = error as FastifyError;

  // Schema validation errors
  if (fastifyError.validation) {
    reply.status(400).send({
      error: 'validation_error',
      message: fastifyError.message,
      details: fastifyError.validation,
    });
    return;
  }

  // Unsupported content-type
  if (fastifyError.statusCode === 415 || fastifyError.code === 'FST_ERR_CTP_UNSUPPORTED_MEDIA_TYPE') {
    reply.status(415).send({
      error: 'unsupported_media_type',
      message: 'Content-Type must be application/json',
    });
    return;
  }

  // Payload too large
  if (fastifyError.statusCode === 413 || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    reply.status(413).send({
      error: 'payload_too_large',
      message: 'Payload exceeds size limit of 1 MiB',
    });
    return;
  }

  // 404
  if (fastifyError.statusCode === 404) {
    reply.status(404).send({
      error: 'not_found',
      message: 'Route not found',
    });
    return;
  }

  // Unknown / unhandled error: log and return 500
  request.log.error({ err: error }, 'Unhandled server error');
  reply.status(500).send({
    error: 'internal_error',
    message: 'Internal server error',
  });
}
