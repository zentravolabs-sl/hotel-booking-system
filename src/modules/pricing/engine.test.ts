import { describe, it, expect } from "vitest";
import { calculatePrice, cancellationCharge, type RatePlanInput } from "./engine";

const rate: RatePlanInput = {
  weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000",
  extraAdultFee: "200", extraChildFee: "100", extraBedFee: "300", includedAdults: 2,
  earlyCheckInFeePerHour: "50", lateCheckOutFeePerHour: "75", multiNightDiscountPercent: "10",
};
const tz = "Asia/Colombo"; // UTC+5:30
// 2026-11-16 is a Monday. Colombo 10:00 = 04:30Z
const at = (iso: string) => new Date(iso);

describe("hourly pricing", () => {
  it("charges per started hour at the weekday rate", () => {
    const p = calculatePrice({ kind: "HOURLY", startAt: at("2026-11-16T04:30:00Z"), endAt: at("2026-11-16T07:10:00Z"), timezone: tz, rate, adults: 2, children: 0 });
    expect(p.units).toBe(3);
    expect(p.total).toBe("3000");
  });
  it("applies the minimum hours", () => {
    const p = calculatePrice({ kind: "HOURLY", startAt: at("2026-11-16T04:30:00Z"), endAt: at("2026-11-16T05:00:00Z"), timezone: tz, rate, adults: 2, children: 0, minHours: 2 });
    expect(p.total).toBe("2000");
  });
  it("uses the property timezone for weekend detection", () => {
    // Fri 2026-11-20 23:00 UTC is already Saturday 04:30 in Colombo -> weekend
    const p = calculatePrice({ kind: "HOURLY", startAt: at("2026-11-20T23:00:00Z"), endAt: at("2026-11-21T00:00:00Z"), timezone: tz, rate, adults: 2, children: 0, weekendDays: [6, 0] });
    expect(p.total).toBe("1500");
  });
});

describe("overnight pricing", () => {
  it("mixes weekday and weekend nights, with multi-night discount", () => {
    // Thu 19, Fri 20 nights -> Thu weekday 1000, Fri weekend 1500 = 2500; 10% off = 2250
    const p = calculatePrice({ kind: "OVERNIGHT", startAt: at("2026-11-19T08:30:00Z"), endAt: at("2026-11-21T05:30:00Z"), timezone: tz, rate, adults: 2, children: 0 });
    expect(p.units).toBe(2);
    expect(p.total).toBe("2250");
  });
  it("applies holiday and seasonal multiplier", () => {
    const p = calculatePrice({
      kind: "OVERNIGHT", startAt: at("2026-12-24T08:30:00Z"), endAt: at("2026-12-25T05:30:00Z"), timezone: tz, rate, adults: 2, children: 0,
      holidays: ["2026-12-24"], seasons: [{ name: "Peak", startDate: "2026-12-20", endDate: "2027-01-05", multiplier: "1.25" }],
    });
    expect(p.total).toBe("2500"); // holiday 2000 * 1.25
  });
  it("charges extra guests/beds per night", () => {
    const p = calculatePrice({ kind: "OVERNIGHT", startAt: at("2026-11-16T08:30:00Z"), endAt: at("2026-11-17T05:30:00Z"), timezone: tz, rate, adults: 3, children: 1, extraBeds: 1 });
    expect(p.total).toBe("1600"); // 1000 + 200 + 100 + 300
  });
});

describe("discounts, service charge, tax and decimals", () => {
  it("applies discount -> service -> tax in order with exact decimals", () => {
    const p = calculatePrice({
      kind: "HOURLY", startAt: at("2026-11-16T04:30:00Z"), endAt: at("2026-11-16T05:30:00Z"), timezone: tz,
      rate: { ...rate, weekdayRate: "333.33" }, adults: 2, children: 0,
      discount: { type: "PERCENT", value: "10" }, serviceChargePercent: "10", taxPercent: "8", depositPercent: "30",
    });
    // 333.33 -10% = 299.997 -> 300.00 ; service 30.00 ; tax (330.00*8%) 26.40
    expect(p.discount).toBe("33.33");
    expect(p.serviceCharge).toBe("30");
    expect(p.tax).toBe("26.4");
    expect(p.total).toBe("356.4");
    expect(p.deposit).toBe("106.92");
  });
  it("never lets a fixed discount exceed the subtotal", () => {
    const p = calculatePrice({ kind: "DAY_USE", startAt: at("2026-11-16T04:30:00Z"), endAt: at("2026-11-16T12:30:00Z"), timezone: tz, rate, adults: 2, children: 0, discount: { type: "FIXED", value: "99999" } });
    expect(p.total).toBe("0");
  });
  it("avoids floating point error", () => {
    const p = calculatePrice({ kind: "HOURLY", startAt: at("2026-11-16T04:30:00Z"), endAt: at("2026-11-16T07:30:00Z"), timezone: tz, rate: { ...rate, weekdayRate: "0.1" }, adults: 2, children: 0 });
    expect(p.total).toBe("0.3");
  });
});

describe("cancellation charges", () => {
  const policy = [{ hoursBefore: 72, chargePercent: 25 }, { hoursBefore: 24, chargePercent: 100 }];
  const start = at("2026-11-20T10:00:00Z");
  it("free when far out", () => expect(cancellationCharge("1000", start, at("2026-11-10T10:00:00Z"), policy).toString()).toBe("0"));
  it("partial within 72h", () => expect(cancellationCharge("1000", start, at("2026-11-18T10:00:00Z"), policy).toString()).toBe("250"));
  it("full within 24h", () => expect(cancellationCharge("1000", start, at("2026-11-19T20:00:00Z"), policy).toString()).toBe("1000"));
});

