// Codes shared by the map snapshot, the lead index, and the online app. No imports:
// the online app (web/) loads this on Vercel, where the SQLite store does not exist.

// Lead status, in precedence order. `rejected` and `verified` come only from
// publisher attestations; the rest describe what the crawl found.
export const STATUSES = [
  { code: "verified", label: "Verified website" },
  { code: "rejected", label: "Rejected website" },
  { code: "directory", label: "Directory or social link" },
  { code: "unresolved", label: "Checked, undecided" },
  { code: "unreachable", label: "Site unreachable" },
  { code: "unchecked", label: "Not checked yet" },
  { code: "no_website", label: "No website" },
];

export const CATEGORIES = [
  { code: "restaurant", label: "Restaurant", types: ["restaurant"] },
  { code: "pizzeria", label: "Pizzeria", types: ["pizzeria"] },
  { code: "bar", label: "Bar", types: ["bar"] },
  { code: "cafe", label: "Café", types: ["cafe"] },
  { code: "pub", label: "Pub", types: ["pub"] },
  { code: "fast_food", label: "Fast food", types: ["fast food"] },
  { code: "ice_cream", label: "Gelateria", types: ["ice cream"] },
  { code: "other", label: "Other", types: [] },
];

export const REGIONS = {
  "01": "Piemonte", "02": "Valle d'Aosta", "03": "Lombardia", "04": "Trentino-Alto Adige",
  "05": "Veneto", "06": "Friuli-Venezia Giulia", "07": "Liguria", "08": "Emilia-Romagna",
  "09": "Toscana", "10": "Umbria", "11": "Marche", "12": "Lazio", "13": "Abruzzo",
  "14": "Molise", "15": "Campania", "16": "Puglia", "17": "Basilicata", "18": "Calabria",
  "19": "Sicilia", "20": "Sardegna",
};

// Sales pipeline stages of the online CRM (PROCESS.md, "Online lead CRM"), in order.
// A venue that is not in the pipeline has no stage ("none" in filters).
export const PIPELINE_STAGES = [
  { code: "shortlisted", label: "Shortlisted" },
  { code: "demo_requested", label: "Demo requested" },
  { code: "demo_ready", label: "Demo ready" },
  { code: "contacted", label: "Contacted" },
  { code: "follow_up", label: "Follow-up" },
  { code: "won", label: "Won" },
  { code: "lost", label: "Lost" },
  { code: "do_not_contact", label: "Do not contact" },
];
