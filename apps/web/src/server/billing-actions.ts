"use server";
// S6: admin billing actions. Both redirect to Polar; neither changes state here (webhooks do).
import { redirect } from "next/navigation";
import { actionViewer } from "./auth";
import { billingView } from "./billing";
import { finish, fail } from "./command";
import { appUrl, polarConfig } from "./env";
import { createCheckoutUrl, createPortalUrl } from "./polar";

const PAGE = "/admin/billing";

export async function upgradeToProAction() {
  const v = await actionViewer("admin");
  const cfg = polarConfig();
  if (cfg === null) finish(PAGE, fail("billing_not_configured"), "");
  const view = await billingView(v.ws);
  let url: string;
  try {
    url = await createCheckoutUrl(cfg, { workspaceId: v.ws, seats: view.plan.activeMembers, successUrl: `${appUrl()}${PAGE}?ok=${encodeURIComponent("Thanks! Pro activates as soon as Polar confirms the payment.")}` });
  } catch {
    finish(PAGE, fail("billing_unavailable"), "");
  }
  redirect(url);
}

export async function manageBillingAction() {
  const v = await actionViewer("admin");
  const cfg = polarConfig();
  if (cfg === null) finish(PAGE, fail("billing_not_configured"), "");
  const view = await billingView(v.ws);
  let url: string;
  try {
    url = await createPortalUrl(cfg, { workspaceId: v.ws, customerId: view.subscription?.customerId ?? null, returnUrl: `${appUrl()}${PAGE}` });
  } catch {
    finish(PAGE, fail("billing_unavailable"), "");
  }
  redirect(url);
}
