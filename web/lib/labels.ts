// Labels shared by the CRM pages (client and server). The codes come from the same
// module the map uses, so both always agree.
import { CATEGORIES, PIPELINE_STAGES, REGIONS, STATUSES } from "@rf/map-constants.mjs";

export { CATEGORIES, PIPELINE_STAGES, REGIONS, STATUSES };

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.code, s.label]));
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.label]));
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.code, s.label]));
export const REGION_NAME: Record<string, string> = REGIONS;
export const OPEN_STAGES = ["shortlisted", "demo_requested", "demo_ready", "contacted", "follow_up"];

export const TOUCH_LABEL: Record<string, string> = {
  visit: "Visit", card: "Card left", letter: "Letter", call: "Call", email: "Email", note: "Note",
  stage: "Stage change", demo: "Demo",
};
export const TOUCH_KINDS = ["visit", "card", "letter", "call", "email", "note"];

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", manager: "Manager", chef: "Chef", staff: "Staff", other: "Other",
};
export const CHANNEL_LABEL: Record<string, string> = {
  visit: "In person", phone: "Phone", email: "Email", letter: "Letter",
};
export const SOURCE_LABEL: Record<string, string> = {
  in_person: "Met in person", business_card: "Business card", venue_website: "Venue's website",
  phone_call: "Phone call", other: "Other",
};
export const DUE_LABEL: Record<string, string> = {
  overdue: "Overdue", today: "Due today or overdue", week: "Due within 7 days", any: "Has a next action",
  none: "In pipeline, no next action",
};

/** Today in Italy as YYYY-MM-DD (next actions are Italian calendar days). */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

export function websiteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
