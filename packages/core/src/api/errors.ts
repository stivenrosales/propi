// Errors the API layer adds on top of DomainError (S97-S100).
import type { DomainError } from "../shared/types.ts";

export type ApiError =
  | DomainError
  | { readonly code: "unauthenticated" } // missing, malformed or unknown token
  | { readonly code: "token_revoked" } // S98
  | { readonly code: "invalid_scope"; readonly scope: string } // S98
  | { readonly code: "token_not_found" }
  | { readonly code: "idempotency_key_required" } // S100
  | { readonly code: "invalid_idempotency_key" } // S100
  | { readonly code: "invalid_request"; readonly field: string }
  | { readonly code: "route_not_found" }
  | { readonly code: "not_implemented"; readonly route: string };

export type ApiOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError };

export const apiOk = <T>(value: T): ApiOutcome<T> => ({ ok: true, value });
export const apiFail = <T = never>(error: ApiError): ApiOutcome<T> => ({ ok: false, error });

/** HTTP status for an error code. Unknown business rejections are 422. */
export function httpStatus(error: { readonly code: string }): number {
  switch (error.code) {
    case "unauthenticated":
    case "token_revoked":
      return 401;
    case "forbidden":
      return 403;
    case "route_not_found":
    case "token_not_found":
    case "gift_not_found":
    case "unknown_member":
      return 404;
    case "idempotency_key_required":
    case "invalid_idempotency_key":
    case "invalid_request":
    case "invalid_scope":
      return 400;
    case "not_implemented":
      return 501;
    case "idempotency_key_reused": // G2, S100
      return 422;
    default:
      return 422;
  }
}
