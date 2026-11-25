// The shape every command handler has (G2-G4). Modules define handlers in their own folder
// and add one line to registry.ts; execute() never switches on command types.
import type {
  CommandBase,
  CommandKey,
  Decision,
  Directory,
  Ids,
  Instant,
  LockKey,
  Tx,
  WorkspaceReader,
  WorkspaceSettings,
} from "@propi/core";

/** Available before locks are taken: read-only, may be stale, used only to name lock keys. */
export interface LockContext {
  readonly directory: Directory;
  readonly reader: WorkspaceReader;
  readonly settings: WorkspaceSettings;
}

/** Available inside the unit of work. */
export interface LoadContext {
  readonly directory: Directory;
  readonly ids: Ids;
  readonly settings: WorkspaceSettings;
  readonly now: Instant;
}

export interface CommandHandler<C extends CommandBase & { readonly type: string }, S, T> {
  readonly type: C["type"];
  /** G4: every lock the command needs, declared up front. Order does not matter; execute sorts them. */
  locks(cmd: C, ctx: LockContext): Promise<readonly LockKey[]> | readonly LockKey[];
  /** Optional: derive the effective command key under the locks (G8 reaction occurrence). Defaults to cmd.key. */
  resolveKey?(cmd: C, tx: Tx, ctx: LoadContext): Promise<CommandKey>;
  /** Read the snapshot the decider needs. Runs only after the key was claimed. */
  load(cmd: C, tx: Tx, ctx: LoadContext): Promise<S>;
  /** The pure core decider. */
  decide(snapshot: S, cmd: C, now: Instant): Decision<T>;
}

/** A handler with its types erased, as stored in the registry. */
export interface RegisteredHandler {
  readonly type: string;
  locks(cmd: never, ctx: LockContext): Promise<readonly LockKey[]> | readonly LockKey[];
  resolveKey?(cmd: never, tx: Tx, ctx: LoadContext): Promise<CommandKey>;
  load(cmd: never, tx: Tx, ctx: LoadContext): Promise<unknown>;
  decide(snapshot: never, cmd: never, now: Instant): Decision<unknown>;
}

export function defineHandler<C extends CommandBase & { readonly type: string }, S, T>(h: CommandHandler<C, S, T>): RegisteredHandler {
  return h as unknown as RegisteredHandler;
}
