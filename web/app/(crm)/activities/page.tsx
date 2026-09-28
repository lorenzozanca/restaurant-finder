import { ActivitiesTable } from "./ActivitiesTable";

export const metadata = { title: "Activities — restaurant-finder" };

export default async function ActivitiesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  return <ActivitiesTable initialQuery={query.toString()} />;
}
