"use client";

import { useEffect, useState } from "react";
import { STAGE_LABEL, STATUS_LABEL, today } from "@/lib/labels";

// Small pieces shared by the CRM pages.

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `HTTP ${response.status}`);
  return data as T;
}

export function StatusDot({ status, label = false }: { status: string; label?: boolean }) {
  return (
    <span className="status">
      <span className={`dot s-${status}`} aria-hidden="true" />
      {label ? STATUS_LABEL[status] ?? status : <span className="sr-only">{STATUS_LABEL[status] ?? status}</span>}
    </span>
  );
}

export function StageTag({ stage }: { stage: string }) {
  if (!stage) return null;
  return <span className={`stage-tag st-${stage}`}>{STAGE_LABEL[stage] ?? stage}</span>;
}

/** A date, red when it is before today. */
export function Due({ on }: { on: string }) {
  if (!on) return null;
  return <span className={on < today() ? "overdue" : undefined}>{formatDay(on)}</span>;
}

export function formatDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short",
    year: y === new Date().getFullYear() ? undefined : "numeric", timeZone: "UTC" });
}

export function useNarrow(width = 760): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${width}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [width]);
  return narrow;
}

export const number = (n: number) => n.toLocaleString("en-GB");
