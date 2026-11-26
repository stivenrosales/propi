"use client";
// i18n S1: the reader's language for client components inside the app frame (forms, error state).
// The app frame (a server component) reads it once with getLocale() and provides it here.
import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@propi/core/i18n";

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export const useLocale = (): Locale => useContext(LocaleContext);
