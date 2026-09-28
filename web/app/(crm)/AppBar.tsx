"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Map", match: (path: string) => path === "/" },
  { href: "/leads", label: "Leads", match: (path: string) => path.startsWith("/leads") || path.startsWith("/venues") },
  { href: "/contacts", label: "Contacts", match: (path: string) => path.startsWith("/contacts") },
  { href: "/activities", label: "Activities", match: (path: string) => path.startsWith("/activities") },
];

export function AppBar({ email }: { email: string }) {
  const path = usePathname();
  return (
    <header className="appbar">
      <nav aria-label="Sections">
        {LINKS.map((link) => (
          // The map is a plain page (ui/map.html), not part of this app's router.
          link.href === "/"
            ? <a key={link.href} href="/" className="nav-link">{link.label}</a>
            : <Link key={link.href} href={link.href} className="nav-link" aria-current={link.match(path) ? "page" : undefined}>
              {link.label}
            </Link>
        ))}
      </nav>
      <span className="who" title={email}>{email}</span>
      <a className="nav-link signout" href="/api/auth/signout">Sign out</a>
    </header>
  );
}
