// The public REST API (docs/api.md, S97-S100). Bearer token auth, Idempotency-Key on writes.
import { handleApiRoute } from "@/server/api-route";
import { propi } from "@/server/propi";

export const dynamic = "force-dynamic";

const handle = (req: Request) => handleApiRoute(req, propi().apiHttp());

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
