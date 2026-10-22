import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAccess } from "@/lib/access";
import { METHODS, TEMPLATE_HEADERS, TERMS } from "@/lib/import-projects";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// The Excel template for bulk import: a "Projects" sheet to fill in, and a "Help" sheet with the rules and the
// services and people that already exist.
export async function GET() {
  const access = await getAccess();
  if (!access || !access.can("manage_projects")) return new NextResponse("Not allowed.", { status: 403 });
  const canPay = access.can("payments");

  const [{ data: services }, { data: people }] = await Promise.all([
    supabase.from("services").select("name").order("name"),
    supabase.from("employees").select("name, email, role").eq("is_active", true).not("email", "is", null).order("name"),
  ]);

  const headers = canPay ? [...TEMPLATE_HEADERS] : TEMPLATE_HEADERS.slice(0, 9);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PMO";
  const ws = wb.addWorksheet("Projects", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
  const widths = [28, 24, 28, 16, 16, 30, 28, 40, 50, 18, 20, 16, 18, 22];
  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = widths[i];
    if (/date|up to/i.test(h)) col.numFmt = "yyyy-mm-dd";
  });
  const termCol = headers.indexOf("Payment term") + 1;
  const methodCol = headers.indexOf("Payment method") + 1;
  for (let r = 2; r <= 501; r++) {
    if (termCol) ws.getCell(r, termCol).dataValidation = { type: "list", allowBlank: true, formulae: [`"${TERMS.map((t) => t.label).join(",")}"`] };
    if (methodCol) ws.getCell(r, methodCol).dataValidation = { type: "list", allowBlank: true, formulae: [`"${METHODS.map((m) => m.label).join(",")}"`] };
  }

  const help = wb.addWorksheet("Help");
  help.getColumn(1).width = 34;
  help.getColumn(2).width = 90;
  const add = (a: string, b = "", bold = false) => { const row = help.addRow([a, b]); if (bold) row.font = { bold: true }; };
  add("How to use this file", "", true);
  add("1", "Fill in one row per project on the Projects sheet, then upload the file on the Projects page (Import from Excel).");
  add("2", "You'll see a preview where you can fix anything before it is saved. Nothing is saved until you press Import.");
  add("", "");
  add("Column", "What to put", true);
  add("Project name, Client name, Website", "Required. Website can be typed as acme.com.");
  add("Onboarding date, Reporting date", "Required. Dates like 2026-10-05 (or 05/10/2026, day first). Reports repeat monthly on the day of the reporting date.");
  add("Services", "Required. One or more, separated by commas. A service that doesn't exist yet is created.");
  add("Project manager (email)", "Optional. The email of an active employee.");
  add("Team members (emails)", "Optional. Emails of active employees, separated by commas.");
  add("Onboarding notes", "Optional.");
  if (canPay) {
    add("First payment date, Amount, Term, Method", "Leave all four empty for no payment plan, or fill in all four. Term and Method have a dropdown.");
    add("Payments collected up to", "Optional. If earlier payments were already collected, the date they were collected up to. They are recorded as paid.");
  }
  add("", "");
  add("Terms", TERMS.map((t) => t.label).join(", "), true);
  add("Methods", METHODS.map((m) => m.label).join(", "), true);
  add("", "");
  add("Services that exist", (services ?? []).map((s) => s.name as string).join(", ") || "none yet", true);
  add("", "");
  add("Employees (use these emails)", "", true);
  for (const p of people ?? []) add(p.email as string, `${p.name}${p.role ? ` (${p.role})` : ""}`);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="projects-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
