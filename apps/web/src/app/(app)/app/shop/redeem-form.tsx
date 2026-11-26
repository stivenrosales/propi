"use client";
// S2 batch redemption: the shop card's redeem form with a quantity stepper. The stepper shows the
// total cost and caps at what the balance and the stock allow; the server (core's Redeem) decides.
// With room for only one unit it renders exactly the single-unit form it replaced.
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useLocale } from "@/components/app/locale-context";
import { Button, KeyInput, Select, Units } from "@/components/app/ui";
import { shop } from "@/i18n/shop.messages";
import { maxUnits } from "@/server/shop-view";

export interface RedeemVariant {
  readonly id: string;
  readonly name: string;
  readonly stock: number | null;
}

export function RedeemForm({
  action,
  formKey,
  rewardId,
  cost,
  redeemable,
  stock,
  variants,
}: {
  action: (form: FormData) => Promise<void>;
  formKey: string;
  rewardId: string;
  cost: number;
  redeemable: number;
  /** Stock of a reward without variants; null = unlimited. */
  stock: number | null;
  variants: readonly RedeemVariant[];
}) {
  const t = shop.t(useLocale());
  const withVariants = variants.length > 0;
  const firstOpen = variants.find((v) => v.stock === null || v.stock > 0)?.id ?? variants[0]?.id ?? null;
  const [variantId, setVariantId] = useState<string | null>(firstOpen);
  const [wanted, setWanted] = useState(1);

  const slotStock = withVariants ? (variants.find((v) => v.id === variantId)?.stock ?? 0) : stock;
  const soldOut = slotStock !== null && slotStock <= 0;
  const short = redeemable < cost;
  const max = soldOut || short ? 1 : maxUnits(cost, redeemable, slotStock);
  const quantity = Math.min(wanted, max);
  const total = cost * quantity;

  return (
    <form action={action} className={max > 1 ? "mt-4 grid gap-2 px-1" : "mt-4 flex gap-2 px-1"}>
      <KeyInput value={formKey} />
      <input type="hidden" name="rewardId" value={rewardId} />
      {max > 1 ? <input type="hidden" name="quantity" value={quantity} /> : null}
      {withVariants ? (
        <Select name="variantId" aria-label={t("variant")} className="flex-1" value={variantId ?? undefined} onChange={(e) => setVariantId(e.currentTarget.value)}>
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={v.stock !== null && v.stock <= 0}>
              {v.name}
              {v.stock !== null ? ` (${v.stock})` : ""}
            </option>
          ))}
        </Select>
      ) : null}
      {max > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center rounded-full border-2 border-ink bg-white" role="group" aria-label={t("howMany")}>
            <button type="button" aria-label={t("fewer")} disabled={quantity <= 1} onClick={() => setWanted(Math.max(1, quantity - 1))} className="grid size-11 place-items-center rounded-full disabled:opacity-40 md:size-9">
              <Minus aria-hidden="true" className="size-4" />
            </button>
            <output aria-live="polite" className="min-w-8 text-center font-display text-lg font-extrabold tabular-nums">
              {quantity}
            </output>
            <button type="button" aria-label={t("more")} disabled={quantity >= max} onClick={() => setWanted(Math.min(max, quantity + 1))} className="grid size-11 place-items-center rounded-full disabled:opacity-40 md:size-9">
              <Plus aria-hidden="true" className="size-4" />
            </button>
          </div>
          <span className="text-sm text-ink-soft">
            {t("total")} <Units n={total} className="text-sm text-ink" />
          </span>
        </div>
      ) : null}
      <Button className="flex-1" confirm={t("confirm", { total })} disabled={soldOut || short} title={short ? t("notEnough") : undefined}>
        {short ? t("need", { count: cost - redeemable }) : quantity > 1 ? t("redeemMany", { count: quantity }) : t("redeem")}
      </Button>
    </form>
  );
}
