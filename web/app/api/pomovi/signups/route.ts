import { recordSelfSignup } from "@/lib/crm";
import { leadIndex, NoSnapshotError, overlayChanged } from "@/lib/leads";
import { authorizePomovi, pomoviJson, PomoviSignupError, signupNotification } from "@/lib/pomovi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = authorizePomovi(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 4096) return pomoviJson({ error: "body too large" }, 413);
    let input: unknown;
    try { input = JSON.parse(text); } catch { return pomoviJson({ error: "invalid JSON" }, 400); }
    const notification = signupNotification(input);
    const result = await recordSelfSignup(await leadIndex(), notification);
    if (!result.duplicate) overlayChanged();
    return pomoviJson(result);
  } catch (error) {
    if (error instanceof PomoviSignupError) return pomoviJson({ error: error.message }, error.status);
    if (error instanceof NoSnapshotError) return pomoviJson({ error: "catalogue unavailable" }, 503);
    throw error;
  }
}
