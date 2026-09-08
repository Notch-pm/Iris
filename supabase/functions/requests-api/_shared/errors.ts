// Enveloppe d'erreurs — vocabulaire commun de la gamme (parité Socle).
// Messages en français, hors périmètre = 404 (jamais révéler l'existence).

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unprocessable"
  | "too_many_requests"
  | "bad_gateway"
  | "internal_error";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unprocessable: 422,
  too_many_requests: 429,
  bad_gateway: 502,
  internal_error: 500,
};

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}
