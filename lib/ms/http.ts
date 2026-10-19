// One place for talking to Microsoft. Every call returns {ok, status, data, error}, where `error` is a
// plain-English reason taken from Microsoft's own reply, so problems are easy to diagnose.
export type MsResult<T = any> = { ok: boolean; status: number; data: T | null; error?: string };

function describe(status: number, body: any, raw: string): string {
  const graph = body?.error;
  if (graph && typeof graph === "object") return `${graph.code ?? status}: ${graph.message ?? "request failed"}`;
  if (typeof body?.error === "string") return `${body.error}: ${String(body.error_description ?? "").split("\r\n")[0]}`.trim();
  if (body?.message) return String(body.message);
  return raw ? raw.slice(0, 200) : `HTTP ${status}`;
}

export async function msRequest<T = any>(
  url: string,
  init: { method?: string; token?: string; json?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}
): Promise<MsResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  try {
    const res = await fetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      /* not JSON */
    }
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, data, error: describe(res.status, data, raw) };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `Could not reach Microsoft: ${e instanceof Error ? e.message : e}` };
  }
}

/** Escapes a value for use inside an OData $filter string. */
export const odataString = (s: string) => s.replace(/'/g, "''");
