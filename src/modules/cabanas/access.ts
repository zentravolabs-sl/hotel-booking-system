import { db } from "@/lib/db";
import { notFound } from "@/lib/api";
import { assertPropertyAccess, type AuthContext } from "@/lib/auth/context";

/** Loads a cabana only if it belongs to the caller's tenant and an accessible property. */
export async function loadCabana(ctx: AuthContext, id: string) {
  const c = await db.cabana.findFirst({ where: { id, organizationId: ctx.organizationId ?? "__none__" } });
  if (!c) throw notFound("Cabana not found");
  await assertPropertyAccess(ctx, c.propertyId);
  return c;
}

