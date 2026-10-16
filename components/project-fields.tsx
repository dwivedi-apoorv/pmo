"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/simple-select";
import { PAYMENT_METHODS, PAYMENT_TERMS, type PaymentPlan } from "@/lib/payments";
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
export function ProjectFields({ values }: { values?: ProjectValues }) {
  const isNew = !values;
  const today = todayISO();

  const [onboarding, setOnboarding] = useState(values?.onboarding_date ?? today);
  const [payment, setPayment] = useState(isNew ? today : (values.payment_date ?? ""));
  const [paymentEdited, setPaymentEdited] = useState(false);

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
      </div>
    </>
  );
}
