export type ApiErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'token_revoked'
  | 'insufficient_permissions'
  | 'rate_limited'
  | 'bad_request'
  | 'user_not_found'
  | 'game_not_found'
  | 'server_unavailable'
  | 'api_disabled'
  | 'internal_error';

export type ClientErrorCode =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'gateway'
  | 'invalid_response'
  | 'game_rejected'
  | 'game_gone';

export type CopsErrorCode = ApiErrorCode | ClientErrorCode;

export interface CopsApiErrorDetails {
  method?: string;
  path?: string;
  local?: boolean;
  cause?: unknown;
}

const RETRYABLE: readonly CopsErrorCode[] = ['rate_limited', 'server_unavailable', 'api_disabled', 'internal_error', 'network', 'timeout', 'gateway'];

export class CopsApiError extends Error {
  override readonly name = 'CopsApiError';
  readonly method?: string;
  readonly path?: string;
  readonly local: boolean;

  constructor(
    readonly code: CopsErrorCode,
    message: string,
    readonly status = 0,
    readonly retryAfter: number | null = null,
    details: CopsApiErrorDetails = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.method = details.method;
    this.path = details.path;
    this.local = details.local ?? false;
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

export function isCopsError(err: unknown, ...codes: CopsErrorCode[]): err is CopsApiError {
  return err instanceof CopsApiError && (codes.length === 0 || codes.includes(err.code));
}
