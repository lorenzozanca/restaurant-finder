import { ContactsTable } from "./ContactsTable";

export const metadata = { title: "Contacts — restaurant-finder" };

export default async function ContactsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  return <ContactsTable initialQuery={query.toString()} />;
}
