import "server-only";
import { venueContacts } from "@rf/crm-records.mjs";
import type { LeadIndex } from "@rf/national-leads.mjs";
import { CrmError, pipelineEntry } from "@/lib/crm";
import { db } from "@/lib/db";
import { pomoviConfigured } from "@/lib/pomovi";
import { venueReview } from "@/lib/review";

/** Everything the venue record page shows, in one answer. */
export async function venueRecord(index: LeadIndex, venueId: string) {
  const i = index.indexOf(venueId);
  if (i < 0) throw new CrmError("unknown venue");
  const [review, pipeline, contacts] = await Promise.all([venueReview(venueId), pipelineEntry(venueId),
    venueContacts(db(), venueId)]);
  return { venue: index.venue(i), row: index.tableRow(i), review, ...pipeline, contacts, pomovi: pomoviConfigured() };
}
