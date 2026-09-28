"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CATEGORY_LABEL, CHANNEL_LABEL, PIPELINE_STAGES, REGION_NAME, ROLE_LABEL, SOURCE_LABEL, STAGE_LABEL, TOUCH_KINDS,
  TOUCH_LABEL, today, websiteHost,
} from "@/lib/labels";
import { api, Due, formatDay, StageTag, StatusDot } from "../../ui";

// A venue as a CRM record. Every change goes through the same APIs as the map's
// venue card, then the whole record is read again.

type Venue = {
  i: number; id: string; name: string; category: string; status: string; stage: string; municipality: string;
  province: string; region: string; region_name: string; address: string; phone: string; verified_url: string;
  candidate_url: string; menu_url: string; assessment: string; failure: string; checked_at: string; lat: number; lon: number;
};
type Entry = {
  stage: string; next_action: string; next_action_on: string | null; lost_reason: string; pomovi_slug: string | null;
  pomovi_status: string | null; pomovi_public_url: string | null; pomovi_wizard_url: string | null;
  pomovi_menu_items: number | null;
};
type Event = {
  id: string; kind: string; stage_from: string | null; stage_to: string | null; note: string; happened_on: string;
  created_by: string; contact_name: string | null;
};
export type Contact = {
  id: string; name: string; role: string; phone: string; email: string; preferred_channel: string; source: string;
  notes: string; updated_at: string; updated_by: string;
};
type Candidate = { domain: string; url: string };
type Review = {
  candidates: Candidate[];
  attestations: { domain: string; status: string; method: string; reviewer?: string; reviewed_at: string; notes?: string }[];
  assessments: { state: string; checked_at: string; candidate_url: string; final_url?: string; evidence?: string[] }[];
  llm: null | { outcome: string; model: string; decided_at: string; reason?: string; final_url?: string; candidate_url?: string;
    quotes?: Record<string, string> };
};
type Record_ = { venue: Venue; review: Review; entry: Entry | null; events: Event[]; contacts: Contact[]; pomovi: boolean };

const OUTCOME: Record<string, string> = { accepted: "accepted it as the official site", rejected: "judged it not official",
  ambiguous: "could not decide" };
const CRAWL: Record<string, string> = { strongly_correlated: "matches the venue strongly", ambiguous: "loaded, identity unclear",
  contradicted: "contradicts the venue record", retryable: "could not be loaded",
  unsupported_publisher: "directory, social or booking site" };
const FAILURE: Record<string, string> = { ENOTFOUND: "the domain no longer exists", http_404: "page not found",
  http_403: "the site blocked the check", timeout: "timed out", EAI_AGAIN: "DNS lookup failed" };

export function VenueRecord({ initial }: { initial: Record_ }) {
  const [record, setRecord] = useState(initial);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const { venue, entry, events, contacts, review } = record;
  const website = venue.verified_url || venue.candidate_url;

  const reload = async () => setRecord(await api<Record_>(`/api/crm/record?id=${encodeURIComponent(venue.id)}`));
  const run = async (action: () => Promise<unknown>, done: string) => {
    setMessage({ text: "Saving…" });
    try {
      await action();
      await reload();
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: `Not saved: ${(error as Error).message}`, error: true });
    }
  };
  const pipeline = (body: Record<string, unknown>, done = "Saved.") =>
    run(() => api("/api/crm/venue", { body: { venue_id: venue.id, ...body } }), done);

  return (
    <div className="record">
      <div className="record-inner">
        <div className="crumbs"><Link href="/leads">← Leads</Link></div>
        <h1>{venue.name}</h1>
        <div className="headline">
          <StatusDot status={venue.status} label />
          {entry ? <StageTag stage={entry.stage} /> : <span className="muted">Not in the pipeline</span>}
          <span>{CATEGORY_LABEL[venue.category]} · {venue.municipality}{venue.province ? ` (${venue.province})` : ""}</span>
        </div>
        <div className="quick">
          {venue.phone ? <a className="btn" href={`tel:${venue.phone.replace(/\s+/g, "")}`}>Call {venue.phone}</a> : null}
          {website ? <a className="btn" href={website} target="_blank" rel="noopener">Website</a> : null}
          <a className="btn" target="_blank" rel="noopener"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name} ${venue.address} ${venue.municipality}`)}`}>
            Directions</a>
          <a className="btn" href={`/map#@${venue.lat},${venue.lon},18z`}>Show on map</a>
        </div>
        {message ? <p className={`note${message.error ? " err" : ""}`} role="status">{message.text}</p> : null}

        <div className="record-grid">
          <div style={{ display: "grid", gap: 16 }}>
            <section className="card">
              <h2>Sales</h2>
              <SalesForm key={JSON.stringify(entry)} entry={entry} onSave={pipeline} />
            </section>
            <section className="card">
              <h2>Contacts <span className="spacer" /></h2>
              <Contacts venueId={venue.id} contacts={contacts} run={run} />
            </section>
            <section className="card">
              <h2>Log a touch</h2>
              {entry?.stage === "do_not_contact"
                ? <p className="banner">Do not contact. Change the stage to reopen this venue first.</p>
                : <TouchForm contacts={contacts} onSave={(event) => pipeline({ event }, "Added to the timeline.")} />}
            </section>
            <section className="card">
              <h2>Timeline</h2>
              {events.length ? (
                <ul className="timeline">
                  {events.map((event) => (
                    <li key={event.id}>
                      {event.kind === "stage"
                        ? <>{event.stage_from ? `${STAGE_LABEL[event.stage_from] ?? event.stage_from} → ` : "Added as "}
                          <b>{STAGE_LABEL[event.stage_to ?? ""] ?? event.stage_to}</b></>
                        : <b>{TOUCH_LABEL[event.kind] ?? event.kind}</b>}
                      {event.contact_name ? <> with {event.contact_name}</> : null}
                      {event.note ? <> — {event.note}</> : null}
                      <div className="when">{formatDay(event.happened_on)} · {event.created_by}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="note">Nothing yet.</p>}
            </section>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <section className="card">
              <h2>Identity</h2>
              <dl className="props">
                <dt>Name</dt><dd>{venue.name}</dd>
                <dt>Category</dt><dd>{CATEGORY_LABEL[venue.category]}</dd>
                <dt>Address</dt><dd>{venue.address || "—"}</dd>
                <dt>Town</dt><dd>{venue.municipality}{venue.province ? ` (${venue.province})` : ""}</dd>
                <dt>Region</dt><dd>{REGION_NAME[venue.region] ?? venue.region_name}</dd>
                <dt>Phone</dt><dd>{venue.phone ? <a href={`tel:${venue.phone.replace(/\s+/g, "")}`}>{venue.phone}</a> : "—"}</dd>
                <dt>Coordinates</dt><dd>{venue.lat.toFixed(5)}, {venue.lon.toFixed(5)}</dd>
                <dt>Venue ID</dt><dd className="muted">{venue.id}</dd>
              </dl>
            </section>
            <section className="card">
              <h2>Website and verification</h2>
              <dl className="props">
                <dt>Status</dt><dd><StatusDot status={venue.status} label /></dd>
                {venue.verified_url ? <><dt>Verified site</dt><dd><a href={venue.verified_url} target="_blank" rel="noopener">{websiteHost(venue.verified_url)}</a></dd></> : null}
                {venue.candidate_url && venue.candidate_url !== venue.verified_url
                  ? <><dt>Candidate</dt><dd><a href={venue.candidate_url} target="_blank" rel="noopener">{venue.candidate_url}</a></dd></> : null}
                {venue.menu_url ? <><dt>Menu</dt><dd><a href={venue.menu_url} target="_blank" rel="noopener">{websiteHost(venue.menu_url)}</a></dd></> : null}
                {venue.checked_at ? <><dt>Checked</dt><dd>{formatDay(venue.checked_at.slice(0, 10))}</dd></> : null}
              </dl>
              <WhyStatus review={review} />
              {review.candidates.length ? <ReviewForm venueId={venue.id} review={review} run={run} /> : null}
            </section>
            <section className="card">
              <h2>Pomovi demo</h2>
              <Demo venueId={venue.id} entry={entry} website={website} verified={Boolean(venue.verified_url)}
                configured={record.pomovi} run={run} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function SalesForm({ entry, onSave }: { entry: Entry | null; onSave: (body: Record<string, unknown>, done?: string) => void }) {
  const [stage, setStage] = useState(entry?.stage ?? "shortlisted");
  const [next, setNext] = useState(entry?.next_action ?? "");
  const [nextOn, setNextOn] = useState(entry?.next_action_on ?? "");
  const [lost, setLost] = useState(entry?.lost_reason ?? "");
  if (!entry) {
    return (
      <div className="form-actions">
        <p className="note" style={{ flexBasis: "100%" }}>Not in the pipeline.</p>
        <button className="btn primary" type="button" onClick={() => onSave({ stage: "shortlisted" }, "Added to the pipeline.")}>
          Add to pipeline</button>
        <button className="btn" type="button" onClick={() => {
          if (confirm("Mark this venue as do not contact?")) onSave({ stage: "do_not_contact" }, "Marked do not contact.");
        }}>Do not contact</button>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={(event) => {
      event.preventDefault();
      const reopen = entry.stage === "do_not_contact" && stage !== "do_not_contact";
      if (reopen && !confirm("This venue is marked do not contact. Reopen it?")) return;
      onSave({ stage, next_action: next, next_action_on: nextOn, lost_reason: lost, reopen });
    }}>
      {entry.stage === "do_not_contact" ? <p className="banner">Do not contact. Changing the stage reopens this venue.</p> : null}
      <label>Stage
        <select className="field" value={stage} onChange={(e) => setStage(e.target.value)}>
          {PIPELINE_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label>Next action<input className="field" value={next} onChange={(e) => setNext(e.target.value)}
          placeholder="e.g. go back with the demo" /></label>
        <label>Due<input className="field" type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} /></label>
      </div>
      {stage === "lost" ? <label>Why lost<input className="field" value={lost} onChange={(e) => setLost(e.target.value)} /></label> : null}
      <div className="form-actions">
        <button className="btn primary" type="submit">Save</button>
        {entry.next_action_on ? <span className="note">Next: <Due on={entry.next_action_on} /> {entry.next_action}</span> : null}
      </div>
    </form>
  );
}

function TouchForm({ contacts, onSave }: { contacts: Contact[]; onSave: (event: Record<string, unknown>) => void }) {
  const [kind, setKind] = useState("visit");
  const [on, setOn] = useState(today());
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="form" onSubmit={(event) => {
      event.preventDefault();
      onSave({ kind, happened_on: on, note, contact_id: contact || undefined });
      setNote("");
    }}>
      <div className="form-row">
        <label>What<select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
          {TOUCH_KINDS.map((k) => <option key={k} value={k}>{TOUCH_LABEL[k]}</option>)}
        </select></label>
        <label>When<input className="field" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
        <label>With<select className="field" value={contact} onChange={(e) => setContact(e.target.value)}>
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      </div>
      <label>Note<textarea className="field" value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="What happened (business only: no private details about people)" /></label>
      <div className="form-actions"><button className="btn primary" type="submit">Add</button></div>
    </form>
  );
}

const EMPTY_CONTACT = { name: "", role: "", phone: "", email: "", preferred_channel: "", source: "", notes: "" };

function Contacts({ venueId, contacts, run }: { venueId: string; contacts: Contact[];
  run: (action: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_CONTACT);
  const open = (contact?: Contact) => {
    setEditing(contact?.id ?? "new");
    setForm(contact ? { name: contact.name, role: contact.role, phone: contact.phone, email: contact.email,
      preferred_channel: contact.preferred_channel, source: contact.source, notes: contact.notes } : EMPTY_CONTACT);
  };
  const field = (key: keyof typeof EMPTY_CONTACT) => ({
    value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
  });
  return (
    <>
      {contacts.length === 0 && editing === null ? <p className="note">No contacts yet.</p> : null}
      {contacts.map((contact) => (editing === contact.id ? null : (
        <div key={contact.id} className="contact">
          <div className="who-line">
            <b>{contact.name}</b>{contact.role ? <span className="muted">{ROLE_LABEL[contact.role]}</span> : null}
            <span style={{ flex: 1 }} />
            <button className="btn" type="button" onClick={() => open(contact)}>Edit</button>
          </div>
          <div>
            {contact.phone ? <a href={`tel:${contact.phone.replace(/\s+/g, "")}`}>{contact.phone}</a> : null}
            {contact.phone && contact.email ? " · " : null}
            {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          </div>
          {contact.notes ? <div>{contact.notes}</div> : null}
          <div className="meta">
            {contact.preferred_channel ? `Prefers ${CHANNEL_LABEL[contact.preferred_channel].toLowerCase()} · ` : ""}
            Source: {SOURCE_LABEL[contact.source]}
          </div>
        </div>
      )))}
      {editing !== null ? (
        <form className="form" style={{ marginTop: 8 }} onSubmit={async (event) => {
          event.preventDefault();
          await run(() => (editing === "new"
            ? api("/api/crm/contact", { body: { venue_id: venueId, ...form } })
            : api(`/api/crm/contact/${editing}`, { body: form })), editing === "new" ? "Contact added." : "Contact saved.");
          setEditing(null);
        }}>
          <div className="form-row">
            <label>Name<input className="field" required {...field("name")} /></label>
            <label>Role<select className="field" {...field("role")}>
              <option value="">—</option>
              {Object.entries(ROLE_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select></label>
          </div>
          <div className="form-row">
            <label>Business phone<input className="field" type="tel" {...field("phone")} /></label>
            <label>Business email<input className="field" type="email" {...field("email")} /></label>
          </div>
          <div className="form-row">
            <label>Prefers<select className="field" {...field("preferred_channel")}>
              <option value="">—</option>
              {Object.entries(CHANNEL_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select></label>
            <label>Where the details came from<select className="field" required {...field("source")}>
              <option value="">Choose…</option>
              {Object.entries(SOURCE_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select></label>
          </div>
          <label>Notes<textarea className="field" {...field("notes")} placeholder="Business notes only" /></label>
          <p className="note">Keep business contact details only. Tell the person at your first contact why you keep them
            and how to object (PRIVACY.md).</p>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editing === "new" ? "Add contact" : "Save"}</button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            {editing !== "new" ? <DeleteContact id={editing} run={run} onDone={() => setEditing(null)} /> : null}
          </div>
        </form>
      ) : <button className="btn" type="button" style={{ marginTop: 8 }} onClick={() => open()}>Add contact</button>}
    </>
  );
}

export function DeleteContact({ id, run, onDone }: { id: string; run: (action: () => Promise<unknown>, done: string) => Promise<void>;
  onDone?: () => void }) {
  return (
    <select className="select" aria-label="Delete contact" value="" onChange={async (event) => {
      const reason = event.target.value;
      if (!reason || !confirm("Delete this contact for good? The timeline keeps only that a contact was removed.")) return;
      await run(() => api(`/api/crm/contact/${id}?reason=${reason}`, { method: "DELETE" }), "Contact deleted.");
      onDone?.();
    }}>
      <option value="">Delete…</option>
      <option value="request">Delete: the person asked</option>
      <option value="retention">Delete: no longer needed</option>
      <option value="mistake">Delete: entered by mistake</option>
    </select>
  );
}

function WhyStatus({ review }: { review: Review }) {
  const { llm } = review;
  if (!llm && !review.assessments.length && !review.attestations.length) return <p className="note">Not checked yet.</p>;
  return (
    <>
      <h2>Why this status</h2>
      {llm ? (
        <>
          <p style={{ margin: "6px 0", fontSize: 14 }}>The LLM reviewer {OUTCOME[llm.outcome] ?? llm.outcome}{" "}
            <span className="muted">({String(llm.model || "").split("/").pop()}, {formatDay(String(llm.decided_at).slice(0, 10))})</span></p>
          {llm.reason ? <p className="reason">{llm.reason}</p> : null}
          <div className="quotes">
            {["name", "municipality", "address", "phone"].map((key) => (
              <span key={key} className={llm.quotes?.[key] ? "hit" : undefined} title={llm.quotes?.[key] || "not found on the page"}>
                {llm.quotes?.[key] ? "✓ " : "– "}{key}</span>
            ))}
          </div>
        </>
      ) : null}
      {review.assessments.slice(0, 2).map((a) => {
        const failure = (a.evidence || []).find((e) => e.startsWith("failure_"))?.slice(8);
        return (
          <p key={`${a.candidate_url}-${a.checked_at}`} style={{ margin: "6px 0", fontSize: 14 }}>
            Crawl {formatDay(a.checked_at.slice(0, 10))}: {CRAWL[a.state] ?? a.state.replace(/_/g, " ")}
            {failure ? ` (${FAILURE[failure] ?? failure.replace(/_/g, " ")})` : ""}
            {a.final_url && a.final_url !== a.candidate_url ? <> · ended at <a href={a.final_url} target="_blank" rel="noopener">{a.final_url}</a></> : null}
          </p>
        );
      })}
      {review.attestations.map((a, k) => (
        <p key={k} style={{ margin: "6px 0", fontSize: 14 }}>
          {a.status === "verified" ? "✓ " : "✗ "}<b>{a.domain}</b> {a.status === "verified" ? "verified" : "rejected"} by{" "}
          {a.method === "manual_first_party_review" ? a.reviewer : "the LLM reviewer"} on {formatDay(a.reviewed_at.slice(0, 10))}
          {a.notes ? ` — ${a.notes}` : ""}
        </p>
      ))}
    </>
  );
}

function ReviewForm({ venueId, review, run }: { venueId: string; review: Review;
  run: (action: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const candidate = review.candidates[pick];
  const suggested = review.llm?.final_url && review.llm.candidate_url === candidate.url ? review.llm.final_url : candidate.url;
  const [site, setSite] = useState(suggested);
  const [evidence, setEvidence] = useState("");
  const [reviewer, setReviewer] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("reviewer") || ""));
  const [notes, setNotes] = useState("");
  if (!open) return <button className="btn" type="button" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Review this website</button>;
  const decide = (decision: "approve" | "reject") => {
    if (!reviewer.trim()) { alert("Enter your name first."); return; }
    localStorage.setItem("reviewer", reviewer.trim());
    const url = decision === "approve" ? site.trim() : candidate.url;
    const pages = evidence.split("\n").map((line) => line.trim()).filter(Boolean);
    run(() => api("/api/national/review", { body: { venue_id: venueId, candidate_domain: candidate.domain, decision,
      website_url: url, evidence_urls: pages.length ? pages : [url], reviewer: reviewer.trim(), notes: notes.trim() || undefined } }),
    decision === "approve" ? "Verified. It reaches the national store on the next laptop sync." : "Rejected.");
    setOpen(false);
  };
  return (
    <div className="form" style={{ marginTop: 8 }}>
      <h2>Your decision</h2>
      {review.candidates.length > 1 ? (
        <label>Candidate<select className="field" value={pick} onChange={(e) => { setPick(Number(e.target.value)); setSite(review.candidates[Number(e.target.value)].url); }}>
          {review.candidates.map((c, k) => <option key={c.domain} value={k}>{c.domain}</option>)}
        </select></label>
      ) : <p style={{ margin: 0 }}>Candidate: <b>{candidate.domain}</b></p>}
      <label>Official website (correct it if the real site is elsewhere)
        <input className="field" type="url" value={site} onChange={(e) => setSite(e.target.value)} /></label>
      <label>Evidence pages, one per line (showing the address or phone)
        <textarea className="field" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://…/contatti" /></label>
      <div className="form-row">
        <label>Your name<input className="field" value={reviewer} onChange={(e) => setReviewer(e.target.value)} autoComplete="name" /></label>
        <label>Notes (optional)<input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button className="btn primary" type="button" onClick={() => decide("approve")}>✓ Official site</button>
        <button className="btn danger" type="button" onClick={() => decide("reject")}>✗ Not official</button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function Demo({ venueId, entry, website, verified, configured, run }: { venueId: string; entry: Entry | null; website: string;
  verified: boolean; configured: boolean; run: (action: () => Promise<unknown>, done: string) => Promise<void> }) {
  if (entry?.pomovi_slug) {
    return (
      <>
        <p style={{ fontSize: 14 }}>Pomovi: <b>{entry.pomovi_slug}</b> · {entry.pomovi_status}
          {entry.pomovi_menu_items != null ? ` · ${entry.pomovi_menu_items} menu items` : ""}</p>
        <div className="form-actions">
          {entry.pomovi_public_url ? <a className="btn" href={entry.pomovi_public_url} target="_blank" rel="noopener">Open the demo</a> : null}
          {entry.pomovi_wizard_url ? <a className="btn" href={entry.pomovi_wizard_url} target="_blank" rel="noopener">Continue in Pomovi</a> : null}
          {configured ? <button className="btn" type="button"
            onClick={() => run(() => api("/api/crm/pomovi-refresh", { body: {} }), "Read from Pomovi.")}>
            Refresh from Pomovi</button> : null}
        </div>
      </>
    );
  }
  if (!configured) return <p className="note">The Pomovi bridge is not configured yet (POMOVI_BRIDGE_URL, POMOVI_BRIDGE_TOKEN).</p>;
  if (!website) return <p className="note">No website to build a demo from.</p>;
  return (
    <>
      <p className="note">Builds from {website}{verified ? "" : " (not verified)"}.</p>
      <button className="btn primary" type="button" disabled={entry?.stage === "do_not_contact"}
        onClick={() => run(() => api("/api/crm/demo", { body: { venue_id: venueId } }), "Demo requested in Pomovi.")}>
        Create demo in Pomovi</button>
    </>
  );
}
