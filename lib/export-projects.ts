import ExcelJS from "exceljs";

export type Cell = string | number | Date | null;

const COLUMN_WIDTH: Record<string, number> = {
  Project: 30, Client: 26, Website: 30, Status: 12, "Status since": 14, "Status reason": 34, Services: 30,
  Onboarded: 14, "Report day": 16, "Next report": 14, "Project manager": 22, Team: 34, "Onboarding notes": 60,
  "Payment amount": 16, Currency: 10, "Payment term": 14, "Payment method": 16, "First payment": 14, "Next payment": 14, "Overdue since": 14,
};

/** Turns "2026-10-05" into a real date (so Excel can sort and filter it); anything else stays as text. */
export const dateCell = (iso: string | null | undefined): Cell => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : (iso ?? null));

/** An .xlsx file with one sheet: bold frozen header, filters on every column, sensible widths. */
export async function buildWorkbook(sheetName: string, headers: string[], rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PMO";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = COLUMN_WIDTH[h] ?? 16;
    if (h === "Payment amount") col.numFmt = "#,##0.00";
    else if (rows.some((r) => r[i] instanceof Date)) col.numFmt = "yyyy-mm-dd";
    if (h === "Onboarding notes" || h === "Status reason" || h === "Team" || h === "Services") col.alignment = { wrapText: true, vertical: "top" };
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
