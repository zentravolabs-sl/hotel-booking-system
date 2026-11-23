import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/api";
import type { AuthContext } from "@/lib/auth/context";

export const guestSchema = z.object({
  firstName: z.string().trim().min(1, "First name required").max(80),
  lastName: z.string().trim().min(1, "Last name required").max(80),
  email: z.string().trim().email("Invalid email").nullable().optional(),
  phone: z.string().trim().min(5).max(30).nullable().optional(),
  nationality: z.string().trim().max(60).nullable().optional(),
  idType: z.enum(["NIC", "PASSPORT", "DRIVING_LICENSE"]).nullable().optional(),
  idNumber: z.string().trim().max(60).nullable().optional(),
  isVip: z.boolean().default(false),
  isBlacklisted: z.boolean().default(false),
  blacklistReason: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  preferences: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
});

export type GuestInput = z.infer<typeof guestSchema>;

/** Mask NIC/Passport unless the caller holds `guest:sensitive`. */
export function sanitizeGuest<T extends { idNumber?: string | null; blacklistReason?: string | null }>(
  g: T,
  canViewSensitive: boolean,
): T {
  if (canViewSensitive) return g;
  const raw = g.idNumber;
  const masked = raw && raw.length > 4 ? `${"•".repeat(raw.length - 4)}${raw.slice(-4)}` : raw ? "••••" : null;
  return { ...g, idNumber: masked, blacklistReason: null };
}

/** Assert caller has `guest:sensitive` when mutating sensitive ID or blacklist fields. */
export function assertSensitiveGuestWrite(ctx: AuthContext, patch: Partial<GuestInput>) {
  const touchesBlacklist = patch.isBlacklisted !== undefined || patch.blacklistReason !== undefined;
  if (touchesBlacklist && !ctx.permissions.has("guest:sensitive")) {
    throw forbidden("You do not have permission to modify the guest blacklist");
  }
}

/** Check-in a confirmed/pending booking: verifies cabana readiness (not MAINTENANCE/INACTIVE/DIRTY), sets booking CHECKED_IN and cabanas OCCUPIED. */
export async function checkInBooking(
  organizationId: string,
  bookingId: string,
  userId: string | null,
  options: { idType?: string; idNumber?: string; nationality?: string; phone?: string; earlyCheckInFee?: number } = {},
) {
  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { items: { include: { cabana: true } }, guest: true },
  });
  if (!b) throw notFound("Booking not found");
  if (!["CONFIRMED", "PENDING"].includes(b.status)) {
    throw conflict(`Cannot check in a booking in ${b.status} status`);
  }
  if (b.guest.isBlacklisted) {
    throw conflict("Guest is blacklisted and cannot be checked in", "GUEST_BLOCKED");
  }

  for (const it of b.items) {
    if (["MAINTENANCE", "INACTIVE"].includes(it.cabana.status)) {
      throw conflict(`Cabana ${it.cabana.code} is ${it.cabana.status} and cannot be occupied`, "CABANA_UNAVAILABLE");
    }
    if (it.cabana.cleaningStatus === "DIRTY" || it.cabana.status === "CLEANING") {
      throw conflict(`Cabana ${it.cabana.code} is not clean/inspected yet`, "NEEDS_CLEANING");
    }
  }

  const now = new Date();
  return db.$transaction(
    async (tx) => {
      if (options.idType || options.idNumber || options.nationality || options.phone) {
        await tx.guest.update({
          where: { id: b.guestId },
          data: {
            ...(options.idType ? { idType: options.idType } : {}),
            ...(options.idNumber ? { idNumber: options.idNumber } : {}),
            ...(options.nationality ? { nationality: options.nationality } : {}),
            ...(options.phone ? { phone: options.phone } : {}),
          },
        });
      }

      let total = b.total;
      if (options.earlyCheckInFee && options.earlyCheckInFee > 0) {
        await tx.bookingCharge.create({
          data: {
            bookingId: b.id,
            type: "EARLY_CHECKIN",
            description: "Early check-in fee",
            quantity: 1,
            unitPrice: options.earlyCheckInFee.toFixed(2),
            amount: options.earlyCheckInFee.toFixed(2),
            createdById: userId,
          },
        });
        total = total.plus(options.earlyCheckInFee.toFixed(2));
      }

      for (const it of b.items) {
        await tx.cabana.update({ where: { id: it.cabanaId }, data: { status: "OCCUPIED" } });
        await tx.cabanaStatusHistory.create({
          data: {
            cabanaId: it.cabanaId,
            fromStatus: it.cabana.status,
            toStatus: "OCCUPIED",
            reason: `Check-in ${b.reference}`,
            changedById: userId,
          },
        });
      }

      return tx.booking.update({
        where: { id: b.id },
        data: {
          status: "CHECKED_IN",
          checkedInAt: now,
          holdExpiresAt: null,
          total,
          history: {
            create: { fromStatus: b.status, toStatus: "CHECKED_IN", note: "Guest checked in", changedById: userId },
          },
        },
        include: { guest: true, items: { include: { cabana: true } }, charges: true, history: true },
      });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Check-out an in-house booking:
 * - Optionally records a late check-out fee
 * - Releases cabana reservation block (`blocking = false`)
 * - Transitions each cabana to `CLEANING` + `cleaningStatus = DIRTY` (never directly to `AVAILABLE`!)
 * - Automatically creates a `CleaningTask` per cabana for Housekeeping.
 */
export async function checkOutBooking(
  organizationId: string,
  bookingId: string,
  userId: string | null,
  options: { lateCheckOutFee?: number; allowUnpaidCheckout?: boolean } = {},
) {
  const b = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: { items: { include: { cabana: true } }, property: { include: { settings: true } } },
  });
  if (!b) throw notFound("Booking not found");
  if (b.status !== "CHECKED_IN") {
    throw conflict(`Only CHECKED_IN bookings can be checked out (current: ${b.status})`);
  }

  let nextTotal = b.total;
  if (options.lateCheckOutFee && options.lateCheckOutFee > 0) {
    nextTotal = nextTotal.plus(options.lateCheckOutFee.toFixed(2));
  }
  const balance = nextTotal.minus(b.paidTotal);
  if (balance.gt(0) && !options.allowUnpaidCheckout) {
    throw conflict(`Outstanding balance of ${balance.toFixed(2)} must be settled or explicitly overridden before check-out`, "BALANCE_DUE");
  }

  const now = new Date();
  return db.$transaction(
    async (tx) => {
      if (options.lateCheckOutFee && options.lateCheckOutFee > 0) {
        await tx.bookingCharge.create({
          data: {
            bookingId: b.id,
            type: "LATE_CHECKOUT",
            description: "Late check-out fee",
            quantity: 1,
            unitPrice: options.lateCheckOutFee.toFixed(2),
            amount: options.lateCheckOutFee.toFixed(2),
            createdById: userId,
          },
        });
      }

      await tx.bookingItem.updateMany({ where: { bookingId: b.id }, data: { blocking: false } });

      for (const it of b.items) {
        // Keep MAINTENANCE cabanas in MAINTENANCE; otherwise move to CLEANING + DIRTY until housekeeping finishes.
        const nextCabanaStatus = it.cabana.status === "MAINTENANCE" ? "MAINTENANCE" : "CLEANING";
        await tx.cabana.update({
          where: { id: it.cabanaId },
          data: { status: nextCabanaStatus, cleaningStatus: "DIRTY" },
        });
        await tx.cabanaStatusHistory.create({
          data: {
            cabanaId: it.cabanaId,
            fromStatus: it.cabana.status,
            toStatus: nextCabanaStatus,
            reason: `Check-out ${b.reference} — queued for cleaning`,
            changedById: userId,
          },
        });
        await tx.cleaningTask.create({
          data: {
            organizationId,
            propertyId: b.propertyId,
            cabanaId: it.cabanaId,
            bookingId: b.id,
            status: "DIRTY",
            priority: "HIGH",
            checklist: [
              { item: "Strip and replace bed linens & towels", done: false },
              { item: "Sanitize bathroom & restock toiletries", done: false },
              { item: "Clean floors, deck & plunge pool area", done: false },
              { item: "Check minibar & check for lost-and-found items", done: false },
            ],
            dueAt: new Date(now.getTime() + (b.property.settings?.turnaroundMinutes ?? 30) * 60_000),
          },
        });
      }

      const nextPay = b.paidTotal.gte(nextTotal) ? "PAID" : b.paidTotal.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
      return tx.booking.update({
        where: { id: b.id },
        data: {
          status: "CHECKED_OUT",
          checkedOutAt: now,
          total: nextTotal,
          paymentStatus: nextPay,
          history: {
            create: {
              fromStatus: "CHECKED_IN",
              toStatus: "CHECKED_OUT",
              note: "Guest checked out; cleaning task(s) created",
              changedById: userId,
            },
          },
        },
        include: { guest: true, items: { include: { cabana: true } }, charges: true, history: true },
      });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

