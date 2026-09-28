"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL, ROLE_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { DeleteContact } from "../venues/[id]/VenueRecord";
import { api, formatDay } from "../ui";

// Every contact with its venue. Pages come from the database by cursor (keyset), so
// a page costs the same however far down the list it is. "Due for deletion" lists
// the contacts past the retention periods in PRIVACY.md.

type ContactRow = {
  id: string; venue_id: string; venue_name: string; municipality: string; province: string; name: string; role: string;
  phone: string; email: string; preferred_channel: string; source: string; notes: string; updated_at: string;
  updated_by: string; due_reason: string | null;
};
type Page = { items: ContactRow[]; next: string };
const SORTS = [{ key: "name", label: "Name" }, { key: "venue", label: "Venue" }, { key: "updated", label: "Last change" }];

export function ContactsTable({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const params = new URLSearchParams(query);
  const sort = params.get("sort") || "name";
  const due = params.get("due") === "1";
  const [search, setSearch] = useState(params.get("q") || "");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [next, setNext] = useState("");
  const [state, setState] = useState<"loading" | "idle" | string>("loading");
  const current = useRef(query);

  const update = useCallback((change: (next: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(current.current);
    change(nextParams);
    const text = nextParams.toString();
    if (text === current.current) return;
    current.current = text;
    window.history.replaceState(null, "", `/contacts${text ? `?${text}` : ""}`);
    setQuery(text);
  }, []);

  const load = useCallback(async (cursor: string) => {
    const forQuery = current.current;
    setState("loading");
    try {
      const page = await api<Page>(`/api/crm/contacts?${forQuery}${cursor ? `&cursor=${cursor}` : ""}`);
      if (current.current !== forQuery) return;
      setRows((before) => (cursor ? [...before, ...page.items] : page.items));
      setNext(page.next);
      setState("idle");
    } catch (error) {
      setState(`Could not load contacts: ${(error as Error).message}`);
    }
  }, []);
  useEffect(() => { load(""); }, [query, load]);
  useEffect(() => {
    const timer = setTimeout(() => update((p) => (search.trim() ? p.set("q", search.trim()) : p.delete("q"))), 250);
    return () => clearTimeout(timer);
  }, [search, update]);

  const run = async (action: () => Promise<unknown>) => {
    try { await action(); await load(""); } catch (error) { alert((error as Error).message); }
  };

  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search a name, email, phone, venue or town" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
        <div className="chips">
          <button className="chip" type="button" aria-pressed={!due} onClick={() => update((p) => p.delete("due"))}>All contacts</button>
          <button className="chip" type="button" aria-pressed={due} onClick={() => update((p) => p.set("due", "1"))}>Due for deletion</button>
        </div>
        <select className="select" aria-label="Sort" value={sort} onChange={(e) => update((p) => p.set("sort", e.target.value))}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
      </div>
      {due ? <p className="note" style={{ padding: "0 12px" }}>Past the retention periods in PRIVACY.md: 12 months after the venue
        was lost or marked do not contact, or 24 months without activity at a venue that never became a customer. Review
        this list at least quarterly.</p> : null}
      <div className="list-wrap">
        <table className="plain">
          <thead><tr>
            <th>Name</th><th>Role</th><th>Venue</th><th>Phone</th><th>Email</th><th>Prefers</th><th>Source</th>
            <th>{due ? "Why due" : "Last change"}</th>{due ? <th /> : null}
          </tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><b>{row.name}</b>{row.notes ? <div className="muted">{row.notes}</div> : null}</td>
                <td data-empty={!row.role}>{ROLE_LABEL[row.role] ?? ""}</td>
                <td><Link href={`/venues/${encodeURIComponent(row.venue_id)}`} prefetch={false}>{row.venue_name}</Link>
                  <div className="muted">{row.municipality}{row.province ? ` (${row.province})` : ""}</div></td>
                <td data-empty={!row.phone}>{row.phone ? <a href={`tel:${row.phone.replace(/\s+/g, "")}`}>{row.phone}</a> : null}</td>
                <td data-empty={!row.email}>{row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : null}</td>
                <td data-empty={!row.preferred_channel}>{CHANNEL_LABEL[row.preferred_channel] ?? ""}</td>
                <td className="muted">{SOURCE_LABEL[row.source]}</td>
                <td className="muted">{due ? row.due_reason : formatDay(String(row.updated_at).slice(0, 10))}</td>
                {due ? <td><DeleteContact id={row.id} run={(action) => run(action)} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {state !== "idle" && state !== "loading" ? <p className="note err more-row">{state}</p> : null}
        {state === "idle" && rows.length === 0
          ? <p className="note more-row">{due ? "No contact is past its retention period." : "No contacts yet. Add them on a venue's record."}</p>
          : null}
        {next ? <div className="more-row"><button className="btn" type="button" disabled={state === "loading"}
          onClick={() => load(next)}>Show more</button></div> : null}
      </div>
    </>
  );
}
