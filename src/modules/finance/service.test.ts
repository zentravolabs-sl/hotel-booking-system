import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createBooking, createBookingSchema } from "@/modules/bookings/service";
import { PayHereAdapter } from "./payhere";
import {
  processPayHereWebhook,
  recordBookingPayment,
  createAndProcessRefund,
  computeFinancialSummary,
} from "./service";

const tag = `p5_${Date.now()}`;
let orgId = "", propertyId = "", cabanaId = "";
const adapter = new PayHereAdapter({ merchantId: "M123", merchantSecret: "SECRET_KEY_999", sandbox: true });

beforeAll(async () => {
  const o = await db.organization.create({ data: { name: tag, slug: tag } });
  orgId = o.id;
  const p = await db.property.create({
    data: {
      organizationId: orgId,
      name: "P5 Resort",
      slug: "p5-resort",
      currency: "LKR",
      settings: { create: { depositPercent: 30 } },
    },
  });
  propertyId = p.id;
  const c = await db.cabana.create({ data: { organizationId: orgId, propertyId, code: "C-P5", name: "Reef Cabana" } });
  cabanaId = c.id;
  await db.ratePlan.create({
    data: { organizationId: orgId, propertyId, name: "Hourly", kind: "HOURLY", weekdayRate: "2000", weekendRate: "2000" },
  });
});

afterAll(async () => {
  await db.refund.deleteMany({ where: { organizationId: orgId } });
  await db.payment.deleteMany({ where: { organizationId: orgId } });
  await db.expense.deleteMany({ where: { organizationId: orgId } });
  await db.expenseCategory.deleteMany({ where: { organizationId: orgId } });
  await db.bookingItem.deleteMany({ where: { organizationId: orgId } });
  await db.booking.deleteMany({ where: { organizationId: orgId } });
  await db.guest.deleteMany({ where: { organizationId: orgId } });
  await db.ratePlan.deleteMany({ where: { organizationId: orgId } });
  await db.cabana.deleteMany({ where: { organizationId: orgId } });
  await db.organization.deleteMany({ where: { id: orgId } });
});

describe("Phase 5: PayHere verification, idempotent payments, refunds & P&L accuracy", () => {
  it("verifies valid PayHere MD5 signatures and rejects tampered payloads", () => {
    const base = {
      merchant_id: "M123",
      order_id: "CP-TEST-1",
      payment_id: "PH-9001",
      payhere_amount: "4000.00",
      payhere_currency: "LKR",
      status_code: "2",
    };
    const sig = adapter.computeNotifySig(base);
    expect(adapter.verifyNotification({ ...base, md5sig: sig }).valid).toBe(true);
    expect(adapter.verifyNotification({ ...base, payhere_amount: "1.00", md5sig: sig }).valid).toBe(false);
  });

  it("handles duplicate PayHere callbacks idempotently, promotes PENDING hold, processes refunds, and never double-counts booking revenue", async () => {
    const startAt = new Date(Date.UTC(2031, 5, 10, 6, 0));
    const endAt = new Date(Date.UTC(2031, 5, 10, 8, 0)); // 2h * 2000 = 4000.00 total, depositRequired = 1200.00
    const b = await createBooking(
      createBookingSchema.parse({
        propertyId,
        cabanaIds: [cabanaId],
        type: "HOURLY",
        startAt,
        endAt,
        adults: 2,
        guest: { firstName: "Kasun", lastName: "Jay", email: `kasun-${tag}@example.com` },
      }),
      { organizationId: orgId, userId: null, source: "WEBSITE" },
    );
    expect(b.status).toBe("PENDING");

    // 1) Advance deposit via PayHere webhook (1500.00 LKR)
    const payloadBase = {
      merchant_id: "M123",
      order_id: b.reference,
      payment_id: `PH-${tag}-1`,
      payhere_amount: "1500.00",
      payhere_currency: "LKR",
      status_code: "2",
    };
    const payload = { ...payloadBase, md5sig: adapter.computeNotifySig(payloadBase) };

    const firstCall = await processPayHereWebhook(payload, adapter);
    expect(firstCall.status).toBe("SUCCEEDED");
    expect(firstCall.duplicate).toBe(false);

    // Duplicate callback with same payment_id -> must be idempotent!
    const secondCall = await processPayHereWebhook(payload, adapter);
    expect(secondCall.duplicate).toBe(true);

    const afterDeposit = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(afterDeposit.status).toBe("CONFIRMED");
    expect(afterDeposit.paymentStatus).toBe("PARTIALLY_PAID");
    expect(afterDeposit.paidTotal.toFixed(2)).toBe("1500.00");

    // 2) Final settlement at Front Desk (2500.00 LKR CASH) -> total paid = 4000.00
    await recordBookingPayment({
      organizationId: orgId,
      bookingId: b.id,
      method: "CASH",
      amount: "2500.00",
      idempotencyKey: `cash-${tag}`,
    });

    const afterSettlement = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(afterSettlement.paymentStatus).toBe("PAID");
    expect(afterSettlement.paidTotal.toFixed(2)).toBe("4000.00");

    // 3) Financial summary: bookingRevenue MUST be 4000.00 (not 1500 + 2500 + 4000!)
    const summary = await computeFinancialSummary({
      organizationId: orgId,
      propertyId,
      from: new Date(Date.UTC(2031, 5, 1)),
      to: new Date(Date.UTC(2031, 5, 30)),
    });
    expect(summary.bookingRevenue).toBe("4000.00");
    expect(summary.totalRevenue).toBe("4000.00");
    expect(summary.outstandingReceivables).toBe("0.00");

    // 4) Refund ceiling enforcement + partial refund
    await expect(
      createAndProcessRefund({
        organizationId: orgId,
        paymentId: firstCall.paymentId!,
        amount: "9999.00",
        reason: "Too much",
        approvedById: null,
      }),
    ).rejects.toMatchObject({ code: "EXCEEDS_PAID" });

    const refund = await createAndProcessRefund({
      organizationId: orgId,
      paymentId: firstCall.paymentId!,
      amount: "500.00",
      reason: "Goodwill discount",
      approvedById: null,
    });
    expect(refund.status).toBe("PROCESSED");

    const afterRefund = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(afterRefund.paidTotal.toFixed(2)).toBe("3500.00");
    expect(afterRefund.paymentStatus).toBe("PARTIALLY_REFUNDED");
  }, 60_000);
});

