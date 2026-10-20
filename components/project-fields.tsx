"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/simple-select";
import { Checkbox } from "@/components/ui/checkbox";
import { backfillDates, hasEarlierMonths, lastMonthEnd } from "@/lib/backfill";
import { PAYMENT_METHODS, PAYMENT_TERMS, formatUSD, type PaymentPlan, type PaymentTerm } from "@/lib/payments";
import { todayISO } from "@/lib/reporting";

export type ProjectValues = {
  name: string;
  client_name: string;
  website: string | null;
  onboarding_date: string;
  reporting_date: string;
} & PaymentPlan;

// Shared by the create and edit dialogs so the two never drift apart.
// Creating (no `values`): dates are pre-filled. Onboarding and reporting start as today, and the
// first payment date follows the onboarding date until you pick a payment date yourself.
export function ProjectFields({ values, showPayment = true }: { values?: ProjectValues; showPayment?: boolean }) {
  const isNew = !values;
  const today = todayISO();

  const [onboarding, setOnboarding] = useState(values?.onboarding_date ?? today);
  const [payment, setPayment] = useState(isNew ? today : (values.payment_date ?? ""));
  const [paymentEdited, setPaymentEdited] = useState(false);
  const [term, setTerm] = useState<PaymentTerm | null>(values?.payment_term ?? null);
  const [amount, setAmount] = useState(values?.payment_amount_usd?.toString() ?? "");
  const [backfill, setBackfill] = useState(false);
  const [until, setUntil] = useState(lastMonthEnd(today));

  // "Earlier payments were already collected" only makes sense when the first payment is before this month.
  const earlier = hasEarlierMonths(payment, today);
  const dates = backfill && earlier ? backfillDates({ payment_date: payment, payment_term: term }, until, today) : [];
  const total = dates.length * (Number(amount) || 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input id="name" name="name" defaultValue={values?.name} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="client_name">Client name</Label>
          <Input id="client_name" name="client_name" defaultValue={values?.client_name} required />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          name="website"
          placeholder="example.com"
          defaultValue={values?.website ?? ""}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="onboarding_date">Date of onboarding</Label>
          <Input
            id="onboarding_date"
            name="onboarding_date"
            type="date"
            value={onboarding}
            onChange={(e) => {
              setOnboarding(e.target.value);
              if (isNew && !paymentEdited) setPayment(e.target.value);
            }}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reporting_date">Date of reporting</Label>
          <Input
            id="reporting_date"
            name="reporting_date"
            type="date"
            defaultValue={values?.reporting_date ?? today}
            required
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Reports repeat monthly on the day of the reporting date, e.g. the 16th of every month.
      </p>

      {showPayment && (
      <div className="grid gap-3 border-t pt-4">
        <p className="text-sm font-medium">Payment</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="payment_date">First payment date</Label>
            <Input
              id="payment_date"
              name="payment_date"
              type="date"
              value={payment}
              onChange={(e) => {
                setPayment(e.target.value);
                setPaymentEdited(true);
              }}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment_amount_usd">Amount (USD)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="payment_amount_usd"
                name="payment_amount_usd"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="pl-6"
                defaultValue={values?.payment_amount_usd ?? ""}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Term</Label>
            <SimpleSelect
              name="payment_term"
              options={PAYMENT_TERMS}
              defaultValue={values?.payment_term ?? null}
              placeholder="Select term"
              onValueChange={(v) => setTerm(v as PaymentTerm | null)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Method</Label>
            <SimpleSelect
              name="payment_method"
              options={PAYMENT_METHODS}
              defaultValue={values?.payment_method ?? null}
              placeholder="Select method"
              required
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Monthly, quarterly and biannual payments repeat on the same day as the first payment date. One-off is
          paid once on that date.
        </p>

        {earlier && (
          <div className="grid gap-3 rounded-md border p-3">
            <Label className="items-start gap-2.5 font-normal">
              <Checkbox checked={backfill} onCheckedChange={(c) => setBackfill(c === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">Earlier payments were already collected</span>
                <span className="block text-xs text-muted-foreground">
                  Records the past payments as paid, so revenue history is complete and nothing shows as overdue.
                </span>
              </span>
            </Label>
            {backfill && (
              <>
                <input type="hidden" name="backfill" value="1" />
                <div className="grid gap-1.5 sm:max-w-xs">
                  <Label htmlFor="backfill_until">Collected up to (and including)</Label>
                  <Input
                    id="backfill_until"
                    name="backfill_until"
                    type="date"
                    value={until}
                    min={payment}
                    max={today}
                    onChange={(e) => setUntil(e.target.value)}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground" role="status">
                  {!term || !Number(amount)
                    ? "Choose the term and amount above to see what will be recorded."
                    : dates.length === 0
                      ? "No payments fall in that range."
                      : `Will record ${dates.length} ${dates.length === 1 ? "payment" : "payments"} as paid (${dates[0]}${
                          dates.length > 1 ? ` to ${dates[dates.length - 1]}` : ""
                        }), ${formatUSD(total)} in total.`}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      )}
    </>
  );
}
