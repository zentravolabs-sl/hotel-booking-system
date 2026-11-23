import { route, ok } from "@/lib/api";
import { destroySession, assertSameOrigin } from "@/lib/auth/session";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  await destroySession();
  return ok({ loggedOut: true });
});

