import { leadIndex, NoSnapshotError } from "@/lib/leads";
import { authorizePomovi, catalogueQuery, pomoviJson, PomoviSignupError, searchPomoviCatalogue } from "@/lib/pomovi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = authorizePomovi(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const query = catalogueQuery({ q: params.get("q") ?? "", municipality: params.get("municipality") ?? "", ref: params.get("ref") ?? "",
      all: params.get("all") ?? "", province: params.get("province") ?? "" });
    return pomoviJson(searchPomoviCatalogue(await leadIndex(), query));
  } catch (error) {
    if (error instanceof PomoviSignupError) return pomoviJson({ error: error.message }, error.status);
    if (error instanceof NoSnapshotError) return pomoviJson({ error: "catalogue unavailable" }, 503);
    throw error;
  }
}
