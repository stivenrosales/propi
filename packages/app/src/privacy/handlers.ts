// S72: uninstall and workspace deletion use cases. Neither takes a balance lock: they move no units.
import { decideDeleteWorkspaceData, decideUninstall, type DeleteWorkspaceData, type DeletionReceipt, type Uninstall, type UninstallReceipt } from "@propi/core/privacy";
import { defineHandler } from "../handler.ts";

export type PrivacyResults = {
  Uninstall: UninstallReceipt;
  DeleteWorkspaceData: DeletionReceipt;
};

export const privacyHandlers = [
  defineHandler<Uninstall, null, UninstallReceipt>({
    type: "Uninstall",
    locks: () => [],
    load: async () => null,
    decide: decideUninstall,
  }),
  defineHandler<DeleteWorkspaceData, null, DeletionReceipt>({
    type: "DeleteWorkspaceData",
    locks: () => [],
    load: async () => null,
    decide: decideDeleteWorkspaceData,
  }),
];
