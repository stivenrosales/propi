// S100: the REST idempotency policy. The app's execute() already replays a claimed key and returns
// idempotency_key_reused when the request hash differs (G2); this module only builds the key.
import type { ApiTokenId, CommandKey, Instant } from "../shared/types.ts";
import { apiFail, apiOk, type ApiOutcome } from "./errors.ts";

/** Visible ASCII, 1..255 characters (UUIDs, ULIDs and most client schemes fit). */
const VALID_KEY = /^[\x21-\x7e]{1,255}$/;

/** `Idempotency-Key` → `api:<tokenId>:<key>`. Keys are per token, so two tokens never collide. */
export function apiCommandKey(tokenId: ApiTokenId, idempotencyKey: string | undefined): ApiOutcome<CommandKey> {
  if (idempotencyKey === undefined || idempotencyKey === "") return apiFail({ code: "idempotency_key_required" });
  if (!VALID_KEY.test(idempotencyKey)) return apiFail({ code: "invalid_idempotency_key" });
  return apiOk(`api:${tokenId}:${idempotencyKey}` as CommandKey);
}

/**
 * The `at` every API command carries. A REST request has no source-event time (the commit records the
 * server time), and a fixed value keeps the request hash a pure function of route + body: a retry sent
 * later hashes the same, and only a different body yields idempotency_key_reused.
 */
export const API_COMMAND_AT = 0 as Instant;
