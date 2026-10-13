import { isAxiosError } from 'axios';
import { apiErrorBodySchema } from './contracts.ts';

/**
 * - `timeout`: no response in time.
 * - `network`: the request could not reach the server (offline, connection refused).
 * - `http`: the server answered with an error status.
 * - `invalid-response`: the server answered, but not with what the contract describes.
 */
export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'invalid-response';

/** Every failure of the ranking and history API, normalized for the UI and the retries. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** Error code from the response body, when the server sent one. */
  readonly code: string | undefined;

  constructor(kind: ApiErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /**
   * Whether trying again may succeed: timeouts, network failures and server errors (5xx,
   * 408, 429). Other client errors (4xx) and invalid responses would fail the same way.
   */
  get transient(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true;
    if (this.kind !== 'http' || this.status === undefined) return false;
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

/**
 * Converts an Axios failure into an ApiError. Cancellations (an aborted signal) are
 * returned unchanged: they are not failures and TanStack Query handles them itself.
 */
export function toApiError(error: unknown): unknown {
  if (error instanceof ApiError || !isAxiosError(error)) return error;
  if (error.code === 'ERR_CANCELED') return error;
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ApiError('timeout', 'The server took too long to answer.');
  }
  if (!error.response) {
    return new ApiError('network', 'The server could not be reached.');
  }
  const { status, data } = error.response;
  const body = apiErrorBodySchema.safeParse(data);
  return new ApiError(
    'http',
    body.success ? body.data.error.message : `The server answered with status ${status}.`,
    status,
    body.success ? body.data.error.code : undefined,
  );
}
