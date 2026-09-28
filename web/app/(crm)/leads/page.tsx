import { parseFilters } from "@rf/national-leads.mjs";
import { leadIndex } from "@/lib/leads";
import { pomoviConfigured } from "@/lib/pomovi";
import { LeadsTable, type LeadsMeta } from "./LeadsTable";

export const metadata = { title: "Leads — restaurant-finder" };

// All 156,057 venues as a table. The first page is rendered here, so rows appear
// with the page; the rest load as the table scrolls (/api/crm/leads).
export default async function LeadsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const index = await leadIndex();
  const meta = index.meta();
  const first = index.table(parseFilters(query), { sort: query.get("sort") || undefined,
    dir: query.get("dir") || undefined, offset: 0, limit: 100 });
  const leadsMeta: LeadsMeta = {
    venues: meta.venues,
    regions: meta.regions.map((r: { code: string; name: string }) => ({ code: r.code, name: r.name })),
    provinces: meta.provinces.map((p: { code: string; region: string }) => ({ code: p.code, region: p.region })),
    pomovi: pomoviConfigured(),
  };
  return <LeadsTable initialQuery={query.toString()} initial={first} meta={leadsMeta} />;
}
