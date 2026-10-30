"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, DownloadIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { importProjects, parseProjectsFile } from "@/app/actions";
import { METHODS, TERMS, emptyRow, hasPaymentData, validateRows, type ImportContext, type ImportRow, type RowErrors } from "@/lib/import-projects";

type Person = { id: string; name: string; email: string | null };

const FIELD = "h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const BAD = "border-destructive bg-destructive/5";

function Text({ value, onChange, error, type = "text", placeholder, width }: { value: string; onChange: (v: string) => void; error?: string; type?: string; placeholder?: string; width?: string }) {
  // A date that isn't a valid yyyy-mm-dd (typed oddly in the sheet) is shown as text so it can be read and fixed.
  const asType = type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value) ? "text" : type;
  return <input type={asType} value={value} placeholder={placeholder} title={error} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} className={`${FIELD} ${width ?? ""} ${error ? BAD : ""}`} />;
}

function Pick({ options, value, onChange, placeholder, error }: { options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder: string; error?: string }) {
  const chosen = options.filter((o) => value.includes(o.id));
  const summary = chosen.length === 0 ? null : chosen.length <= 2 ? chosen.map((o) => o.name).join(", ") : `${chosen[0].name}, ${chosen[1].name} +${chosen.length - 2}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" title={error} className={`${FIELD} flex items-center justify-between gap-1 text-left ${error ? BAD : ""}`} />}>
        <span className={summary ? "truncate" : "truncate text-muted-foreground"}>{summary ?? placeholder}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
        {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing to pick.</p>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.id} checked={value.includes(o.id)} closeOnClick={false} onCheckedChange={(on) => onChange(on ? [...value, o.id] : value.filter((x) => x !== o.id))}>
            {o.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chip({ children, onRemove, bad }: { children: React.ReactNode; onRemove: () => void; bad?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${bad ? "bg-destructive/10 text-destructive" : "bg-secondary"}`}>
      {children}
      <button type="button" aria-label="Remove" className="opacity-60 hover:opacity-100" onClick={onRemove}><XIcon className="size-3" /></button>
    </span>
  );
}

export function ImportProjectsDialog({ employees, services, existing, canPay, currencies, today }: Omit<ImportContext, never> & { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const ctx: ImportContext = useMemo(() => ({ employees, services, existing, canPay, currencies, today }), [employees, services, existing, canPay, currencies, today]);
  const errors: RowErrors[] = useMemo(() => (rows ? validateRows(rows, ctx) : []), [rows, ctx]);
  const ready = errors.filter((e) => Object.keys(e).length === 0).length;
  const serviceNames = new Set(services.map((s) => s.name.toLowerCase()));

  const update = (i: number, patch: Partial<ImportRow>) => {
    setRows((rs) => rs!.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setServerErrors((e) => { const { [i]: _drop, ...rest } = e; return rest; });
  };
  const close = () => { setOpen(false); setRows(null); setMessage(null); setServerErrors({}); };

  function onFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    start(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await parseProjectsFile(fd);
      if (!res.ok) setMessage({ ok: false, text: res.error });
      else { setRows(res.rows); setServerErrors({}); setDraft({}); }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function doImport() {
    if (!rows) return;
    const send = rows.map((r, i) => ({ r, i })).filter(({ i }) => Object.keys(errors[i]).length === 0);
    start(async () => {
      try {
        const results = await importProjects(send.map((s) => s.r));
        const done = new Set<number>();
        const failed: Record<number, string> = {};
        results.forEach((res, k) => (res.ok ? done.add(send[k].i) : (failed[send[k].i] = res.error ?? "Failed")));
        const left = rows.filter((_, i) => !done.has(i));
        const remap: Record<number, string> = {};
        rows.forEach((_, i) => { if (failed[i]) remap[left.indexOf(rows[i])] = failed[i]; });
        setRows(left);
        setServerErrors(remap);
        setMessage({ ok: done.size > 0 && left.length === 0, text: `Imported ${done.size} ${done.size === 1 ? "project" : "projects"}.${left.length ? ` ${left.length} ${left.length === 1 ? "row is" : "rows are"} still here: fix and import again, or remove.` : ""}` });
        router.refresh();
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><UploadIcon /> Import from Excel</Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col gap-4 overflow-hidden sm:max-w-[96vw]">
          <DialogHeader>
            <DialogTitle>Import projects from Excel</DialogTitle>
            <DialogDescription>
              {rows ? "Check the rows below. Click any cell to fix it. Nothing is saved until you press Import." : "Upload a filled-in template. You'll get to check and fix everything before anything is saved."}
            </DialogDescription>
          </DialogHeader>

          {!rows && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href="/api/import/projects/template" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"><DownloadIcon className="size-4" /> Download the template</a>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <Button onClick={() => fileRef.current?.click()} disabled={pending}><UploadIcon /> {pending ? "Reading…" : "Choose an Excel file"}</Button>
              </div>
              <p className="text-sm text-muted-foreground">Only .xlsx files, up to 500 projects. The template has a Help sheet listing the services and employee emails you can use.</p>
            </div>
          )}

          {message && <p role="status" className={`text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}

          {rows && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm"><span className="font-semibold">{ready}</span> ready{rows.length - ready > 0 && <>, <span className="font-semibold text-destructive">{rows.length - ready}</span> need fixing</>}</span>
                <Button onClick={doImport} disabled={pending || ready === 0}>{pending ? "Importing…" : `Import ${ready} ${ready === 1 ? "project" : "projects"}`}</Button>
                <Button variant="outline" onClick={() => setRows([...rows, emptyRow()])}><PlusIcon /> Add a row</Button>
                <Button variant="ghost" onClick={() => { setRows(null); setMessage(null); }}>Choose another file</Button>
                {rows.length - ready > 0 && <span className="text-xs text-muted-foreground">Rows that still have a problem are left out of the import.</span>}
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      {["#", "Project", "Client", "Website", "Onboarded", "Reporting", "Services", "Manager", "Team", "Onboarding notes", ...(canPay ? ["First payment", "Amount", "Currency", "Term", "Method", "Collected up to"] : []), "Status", ""].map((h) => (
                        <th key={h} className="whitespace-nowrap border-b px-2 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const e = errors[i];
                      const problems = [...Object.values(e), ...(serverErrors[i] ? [serverErrors[i]] : [])];
                      const newServices = r.services.filter((n) => !serviceNames.has(n.toLowerCase()));
                      const known = services.filter((s) => r.services.some((n) => n.toLowerCase() === s.name.toLowerCase()));
                      const payOff = canPay && hasPaymentData(r);
                      return (
                        <tr key={i} className={`align-top ${problems.length ? "bg-destructive/[0.03]" : ""}`}>
                          <td className="border-b px-2 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="min-w-44 border-b px-1 py-1.5"><Text value={r.name} error={e.name} onChange={(v) => update(i, { name: v })} /></td>
                          <td className="min-w-40 border-b px-1 py-1.5"><Text value={r.client} error={e.client} onChange={(v) => update(i, { client: v })} /></td>
                          <td className="min-w-44 border-b px-1 py-1.5"><Text value={r.website} error={e.website} onChange={(v) => update(i, { website: v })} placeholder="acme.com" /></td>
                          <td className="min-w-36 border-b px-1 py-1.5"><Text type="date" value={r.onboarded} error={e.onboarded} onChange={(v) => update(i, { onboarded: v })} /></td>
                          <td className="min-w-36 border-b px-1 py-1.5"><Text type="date" value={r.reporting} error={e.reporting} onChange={(v) => update(i, { reporting: v })} /></td>
                          <td className="min-w-52 border-b px-1 py-1.5">
                            <Pick
                              options={services}
                              value={known.map((s) => s.id)}
                              error={e.services}
                              placeholder="Select services"
                              onChange={(ids) => update(i, { services: [...services.filter((s) => ids.includes(s.id)).map((s) => s.name), ...newServices] })}
                            />
                            <div className="mt-1 flex flex-wrap gap-1">
                              {newServices.map((n) => <Chip key={n} onRemove={() => update(i, { services: r.services.filter((x) => x !== n) })}>{n} <span className="text-muted-foreground">(new)</span></Chip>)}
                            </div>
                            <input
                              value={draft[i] ?? ""}
                              maxLength={40}
                              placeholder="+ new service, Enter"
                              aria-label="New service"
                              className="mt-1 h-7 w-full rounded-md border border-dashed bg-transparent px-2 text-xs outline-none"
                              onChange={(ev) => setDraft({ ...draft, [i]: ev.target.value })}
                              onKeyDown={(ev) => {
                                if (ev.key !== "Enter") return;
                                ev.preventDefault();
                                const n = (draft[i] ?? "").trim().replace(/\s+/g, " ");
                                if (!n) return;
                                const match = services.find((s) => s.name.toLowerCase() === n.toLowerCase())?.name ?? n;
                                if (!r.services.some((x) => x.toLowerCase() === match.toLowerCase())) update(i, { services: [...r.services, match] });
                                setDraft({ ...draft, [i]: "" });
                              }}
                            />
                          </td>
                          <td className="min-w-44 border-b px-1 py-1.5">
                            <select
                              value={r.managerId}
                              title={e.managerId}
                              onChange={(ev) => update(i, { managerId: ev.target.value, managerRaw: "" })}
                              className={`${FIELD} ${e.managerId ? BAD : ""}`}
                              aria-label="Project manager"
                            >
                              <option value="">{r.managerRaw ? `“${r.managerRaw}” not found: pick…` : "— None —"}</option>
                              {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </td>
                          <td className="min-w-48 border-b px-1 py-1.5">
                            <Pick options={employees} value={r.teamIds} error={e.teamIds} placeholder="Select team" onChange={(ids) => update(i, { teamIds: ids })} />
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.teamRaw.map((t) => <Chip key={t} bad onRemove={() => update(i, { teamRaw: r.teamRaw.filter((x) => x !== t) })}>{t} not found</Chip>)}
                            </div>
                          </td>
                          <td className="min-w-56 border-b px-1 py-1.5"><textarea value={r.notes} rows={1} onChange={(ev) => update(i, { notes: ev.target.value })} className={`${FIELD} h-8 min-h-8 resize-y py-1`} aria-label="Onboarding notes" /></td>
                          {canPay && (
                            <>
                              <td className="min-w-36 border-b px-1 py-1.5"><Text type="date" value={r.payDate} error={e.payDate} onChange={(v) => update(i, { payDate: v })} /></td>
                              <td className="min-w-28 border-b px-1 py-1.5"><Text value={r.amount} error={e.amount} placeholder="500" onChange={(v) => update(i, { amount: v })} /></td>
                              <td className="min-w-28 border-b px-1 py-1.5">
                                <select
                                  value={currencies.includes(r.currency) ? r.currency : "__new__"}
                                  title={e.currency}
                                  onChange={(ev) => update(i, { currency: ev.target.value === "__new__" ? "" : ev.target.value })}
                                  className={`${FIELD} ${e.currency ? BAD : ""}`}
                                  aria-label="Currency"
                                >
                                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                                  <option value="__new__">＋ Add…</option>
                                </select>
                                {!currencies.includes(r.currency) && (
                                  <input value={r.currency} maxLength={3} placeholder="e.g. GBP" aria-label="New currency code" onChange={(ev) => update(i, { currency: ev.target.value.toUpperCase() })} className={`${FIELD} mt-1 uppercase ${e.currency ? BAD : ""}`} />
                                )}
                              </td>
                              <td className="min-w-32 border-b px-1 py-1.5">
                                <select value={TERMS.some((t) => t.value === r.term) ? r.term : ""} title={e.term} onChange={(ev) => update(i, { term: ev.target.value })} className={`${FIELD} ${e.term ? BAD : ""}`} aria-label="Payment term">
                                  <option value="">{r.term && !TERMS.some((t) => t.value === r.term) ? `“${r.term}”: pick…` : "—"}</option>
                                  {TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                              </td>
                              <td className="min-w-36 border-b px-1 py-1.5">
                                <select value={METHODS.some((m) => m.value === r.method) ? r.method : ""} title={e.method} onChange={(ev) => update(i, { method: ev.target.value })} className={`${FIELD} ${e.method ? BAD : ""}`} aria-label="Payment method">
                                  <option value="">{r.method && !METHODS.some((m) => m.value === r.method) ? `“${r.method}”: pick…` : "—"}</option>
                                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                              </td>
                              <td className="min-w-36 border-b px-1 py-1.5"><Text type="date" value={r.collectedUpTo} error={e.collectedUpTo} onChange={(v) => update(i, { collectedUpTo: v })} /></td>
                            </>
                          )}
                          <td className="min-w-56 border-b px-2 py-2">
                            {problems.length === 0 ? (
                              <span className="text-xs font-medium text-emerald-600">✓ Ready{payOff ? "" : ""}</span>
                            ) : (
                              <ul className="grid gap-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>✗ {p}</li>)}</ul>
                            )}
                          </td>
                          <td className="border-b px-1 py-1.5">
                            <button type="button" aria-label={`Remove row ${i + 1}`} title="Remove this row" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { setRows(rows.filter((_, k) => k !== i)); setServerErrors({}); }}><XIcon className="size-4" /></button>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={20} className="px-3 py-6 text-center text-muted-foreground">No rows left.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
