"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PIPELINE_STAGES, STAGE_LABEL, TOUCH_LABEL } from "@/lib/labels";
import { api, formatDay, StageTag } from "../ui";

// Every touch and stage change across venues, newest first, a page at a time
// (keyset on date and id): "what did I do this week", "every letter sent in May".

type ActivityRow = {
  id: string; venue_id: string; kind: string; stage_from: string | null; stage_to: string | null; note: string;
  happened_on: string; created_by: string; contact_name: string | null; venue_name: string; municipality: string;
  province: string; stage: string;
};
type Page = { items: ActivityRow[]; next: string };
const KINDS = ["visit", "card", "letter", "call", "email", "note", "stage", "demo"];

function weekStart(): string {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

export function ActivitiesTable({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const params = new URLSearchParams(query);
  const kinds = (params.get("kind") || "").split(",").filter(Boolean);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [next, setNext] = useState("");
  const [state, setState] = useState<"loading" | "idle" | string>("loading");
  const current = useRef(query);

  const update = useCallback((change: (next: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(current.current);
    change(nextParams);
    const text = nextParams.toString();
    if (text === current.current) return;
    current.current = text;
    window.history.replaceState(null, "", `/activities${text ? `?${text}` : ""}`);
    setQuery(text);
  }, []);
  const load = useCallback(async (cursor: string) => {
    const forQuery = current.current;
    setState("loading");
    try {
      const page = await api<Page>(`/api/crm/activities?${forQuery}${cursor ? `&cursor=${cursor}` : ""}`);
      if (current.current !== forQuery) return;
      setRows((before) => (cursor ? [...before, ...page.items] : page.items));
      setNext(page.next);
      setState("idle");
    } catch (error) {
      setState(`Could not load activities: ${(error as Error).message}`);
    }
  }, []);
  useEffect(() => { load(""); }, [query, load]);

  const toggleKind = (kind: string) => update((p) => {
    const set = new Set(kinds);
    if (set.has(kind)) set.delete(kind); else set.add(kind);
    if (set.size) p.set("kind", [...set].join(",")); else p.delete("kind");
  });
  const setParam = (key: string, value: string) => update((p) => (value ? p.set(key, value) : p.delete(key)));

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {KINDS.map((kind) => (
            <button key={kind} className="chip" type="button" aria-pressed={kinds.includes(kind)} onClick={() => toggleKind(kind)}>
              {TOUCH_LABEL[kind]}</button>
          ))}
        </div>
        <label className="count">From <input className="select" type="date" value={params.get("from") || ""}
          onChange={(e) => setParam("from", e.target.value)} /></label>
        <label className="count">To <input className="select" type="date" value={params.get("to") || ""}
          onChange={(e) => setParam("to", e.target.value)} /></label>
        <button className="btn" type="button" onClick={() => update((p) => { p.set("from", weekStart()); p.delete("to"); })}>This week</button>
        <select className="select" aria-label="Venue stage" value={params.get("stage") || ""} onChange={(e) => setParam("stage", e.target.value)}>
          <option value="">Venues in any stage</option>
          {PIPELINE_STAGES.map((s) => <option key={s.code} value={s.code}>Now {s.label.toLowerCase()}</option>)}
        </select>
        {query ? <button className="btn" type="button" onClick={() => update((p) => { for (const k of [...p.keys()]) p.delete(k); })}>Clear</button> : null}
      </div>
      <div className="list-wrap">
        <table className="plain">
          <thead><tr><th>Date</th><th>What</th><th>Venue</th><th>With</th><th>Note</th><th>By</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDay(row.happened_on)}</td>
                <td>{row.kind === "stage"
                  ? <>{row.stage_from ? `${STAGE_LABEL[row.stage_from] ?? row.stage_from} → ` : "Added as "}<b>{STAGE_LABEL[row.stage_to ?? ""] ?? row.stage_to}</b></>
                  : <b>{TOUCH_LABEL[row.kind] ?? row.kind}</b>}</td>
                <td><Link href={`/venues/${encodeURIComponent(row.venue_id)}`} prefetch={false}>{row.venue_name}</Link>{" "}
                  <StageTag stage={row.stage} />
                  <div className="muted">{row.municipality}{row.province ? ` (${row.province})` : ""}</div></td>
                <td data-empty={!row.contact_name}>{row.contact_name}</td>
                <td data-empty={!row.note}>{row.note}</td>
                <td className="muted">{row.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {state !== "idle" && state !== "loading" ? <p className="note err more-row">{state}</p> : null}
        {state === "idle" && rows.length === 0 ? <p className="note more-row">No activity matches.</p> : null}
        {next ? <div className="more-row"><button className="btn" type="button" disabled={state === "loading"}
          onClick={() => load(next)}>Show more</button></div> : null}
      </div>
    </>
  );
}
