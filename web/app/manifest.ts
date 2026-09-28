import type { MetadataRoute } from "next";

// Installable from restaurants.trelua.com; no service worker — the Leads table and map
// are live data behind a sign-in, so an offline copy would only show stale rows.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Restaurant finder",
    short_name: "Restaurants",
    start_url: "/leads",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
