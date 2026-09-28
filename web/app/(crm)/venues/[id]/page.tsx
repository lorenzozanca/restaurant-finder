import { notFound } from "next/navigation";
import { CrmError } from "@/lib/crm";
import { leadIndex } from "@/lib/leads";
import { venueRecord } from "@/lib/record";
import { VenueRecord } from "./VenueRecord";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const index = await leadIndex();
  const i = index.indexOf(decodeURIComponent((await params).id));
  return { title: `${i >= 0 ? index.columns.name[i] : "Venue"} — restaurant-finder` };
}

// One venue as a CRM record: properties by group, website verification, sales,
// contacts, the timeline, and every action on it.
export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  try {
    const record = await venueRecord(await leadIndex(), id);
    return <VenueRecord initial={JSON.parse(JSON.stringify(record))} />;
  } catch (error) {
    if (error instanceof CrmError) notFound();
    throw error;
  }
}
