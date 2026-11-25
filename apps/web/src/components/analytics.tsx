"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Product analytics, off unless the build sets NEXT_PUBLIC_POSTHOG_KEY
 * (deploy.sh reads POSTHOG_KEY from the server env).
 * Events go through the /ingest rewrite in next.config.ts so ad blockers
 * do not drop them. Visitors stay anonymous: no person profiles.
 */
const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function Analytics() {
  useEffect(() => {
    if (!apiKey || posthog.__loaded) return;
    posthog.init(apiKey, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      capture_pageview: "history_change",
      person_profiles: "identified_only",
      respect_dnt: true,
    });
  }, []);
  return null;
}
