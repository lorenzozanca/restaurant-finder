import { redirect } from "next/navigation";
import { currentEmail } from "@/lib/session";
import { AppBar } from "./AppBar";
import "./crm.css";

// The CRM views (PROCESS.md, "CRM views"): Leads, venue records, Contacts, Activities.
// The map at / is ui/map.html and links here. Every page needs an allowed session.
export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const email = await currentEmail();
  if (!email) redirect("/signin");
  return (
    <div className="crm">
      <AppBar email={email} />
      <main className="crm-main">{children}</main>
    </div>
  );
}
