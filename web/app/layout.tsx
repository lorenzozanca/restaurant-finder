import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "restaurant-finder",
  appleWebApp: { capable: true, title: "Restaurants", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, font: "15px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
