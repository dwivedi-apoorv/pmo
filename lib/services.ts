// A project's services (SEO, Ads, Shopify, ...). A project can have several.
export type Service = { id: string; name: string };

/** Shape of a project row fetched with `project_services(services(id, name))`. */
export type WithServices = { project_services: { services: Service | null }[] };

export const servicesOf = (p: WithServices): Service[] =>
  p.project_services.flatMap((ps) => (ps.services ? [ps.services] : [])).sort((a, b) => a.name.localeCompare(b.name));

export type ServiceCoverage = {
  name: string;
  projects: number; // active projects with this service
  clients: number; // different clients among those active projects
  clientsEver: number; // different clients over every project ever given this service (halted and ended too)
};

/** Client names are typed by hand, so "Acme", "acme " and "ACME" count as one client. */
export const clientKey = (name: string | undefined) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const NO_SERVICE = "No service";

/**
 * How many projects each service is on. Every service in the list appears, even with no projects yet.
 * A project with several services counts once under each. Projects with no service show as "No service".
 */
export function serviceCoverage(
  allServices: Service[],
  servicesByProject: Map<string, Service[]>,
  activeProjectIds: string[],
  clientOf: (projectId: string) => string | undefined = () => undefined,
  allProjectIds: string[] = activeProjectIds
): ServiceCoverage[] {
  const rows = new Map<string, ServiceCoverage>(
    allServices.map((s) => [s.name, { name: s.name, projects: 0, clients: 0, clientsEver: 0 }])
  );
  const row = (name: string) => {
    const r = rows.get(name) ?? { name, projects: 0, clients: 0, clientsEver: 0 };
    rows.set(name, r);
    return r;
  };
  const active = new Map<string, Set<string>>();
  const ever = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, service: string, client: string) => {
    if (client) map.set(service, (map.get(service) ?? new Set()).add(client));
  };
  const namesFor = (id: string) => {
    const svcs = servicesByProject.get(id) ?? [];
    return svcs.length ? svcs.map((s) => s.name) : [NO_SERVICE];
  };

  for (const id of activeProjectIds) {
    for (const name of namesFor(id)) {
      row(name).projects++;
      add(active, name, clientKey(clientOf(id)));
    }
  }
  for (const id of allProjectIds) for (const name of namesFor(id)) add(ever, name, clientKey(clientOf(id)));
  for (const [name, set] of active) row(name).clients = set.size;
  for (const [name, set] of ever) row(name).clientsEver = set.size;

  // "No service" only appears if some active project has none; it always sorts last.
  return [...rows.values()]
    .filter((r) => r.name !== NO_SERVICE || r.projects > 0)
    .sort(
      (a, b) =>
        Number(a.name === NO_SERVICE) - Number(b.name === NO_SERVICE) ||
        b.projects - a.projects ||
        b.clientsEver - a.clientsEver ||
        a.name.localeCompare(b.name)
    );
}
