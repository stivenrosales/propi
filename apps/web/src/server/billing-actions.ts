"use server";
// S6: admin billing actions. Both redirect to Polar; neither changes state here (webhooks do).
// S12a: checkout is refused while the workspace already has a live subscription.
import { redirect } from "next/navigation";
import { canStartCheckout, type Instant } from "@propi/app";
import { actions } from "@/i18n/actions.messages";
import { getLocale } from "@/i18n/locale";
import { actionViewer } from "./auth";
import { billingView } from "./billing";
import { finish, fail } from "./command";
import { appUrl, polarConfig } from "./env";
import { createCheckoutUrl, createPortalUrl } from "./polar";

const PAGE = "/admin/billing";

export async function upgradeToProAction() {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const cfg = polarConfig();
  if (cfg === null) finish(PAGE, fail("billing_not_configured"), "", L);
  const view = await billingView(v.ws);
  // S12a: one live subscription per workspace; a second checkout would start a second subscription.
  if (!canStartCheckout({ subscription: view.subscription, comped: false }, Date.now() as Instant)) finish(PAGE, fail("already_subscribed"), "", L);
  let url: string;
  try {
    url = await createCheckoutUrl(cfg, { workspaceId: v.ws, seats: view.plan.activeMembers, successUrl: `${appUrl()}${PAGE}?ok=${encodeURIComponent(actions.t(L)("billing.thanks"))}` });
  } catch {
    finish(PAGE, fail("billing_unavailable"), "", L);
  }
  redirect(url);
}

export async function manageBillingAction() {
  const v = await actionViewer("admin");
  const L = await getLocale();
  const cfg = polarConfig();
  if (cfg === null) finish(PAGE, fail("billing_not_configured"), "", L);
  const view = await billingView(v.ws);
  let url: string;
  try {
    url = await createPortalUrl(cfg, { workspaceId: v.ws, customerId: view.subscription?.customerId ?? null, returnUrl: `${appUrl()}${PAGE}` });
  } catch {
    finish(PAGE, fail("billing_unavailable"), "", L);
  }
  redirect(url);
}
