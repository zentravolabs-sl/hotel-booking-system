import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type PriceKind = "HOURLY" | "DAY_USE" | "OVERNIGHT";

export interface RatePlanInput {
  weekdayRate: Prisma.Decimal.Value;
  weekendRate: Prisma.Decimal.Value;
  holidayRate?: Prisma.Decimal.Value | null;
  extraAdultFee: Prisma.Decimal.Value;
  extraChildFee: Prisma.Decimal.Value;
  extraBedFee: Prisma.Decimal.Value;
  includedAdults: number;
  earlyCheckInFeePerHour?: Prisma.Decimal.Value;
  lateCheckOutFeePerHour?: Prisma.Decimal.Value;
  multiNightDiscountPercent?: Prisma.Decimal.Value;
}
export interface SeasonInput {
  name: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;
  multiplier: Prisma.Decimal.Value;
  priority?: number;
}
export interface PriceInput {
  kind: PriceKind;
  startAt: Date;
  endAt: Date;
  timezone: string;
  rate: RatePlanInput;
  seasons?: SeasonInput[];
  holidays?: string[]; // YYYY-MM-DD in property tz
  weekendDays?: number[]; // 0=Sun..6=Sat, applied to the *night/day* date; default Fri+Sat nights
  minHours?: number;
  adults: number;
  children: number;
  extraBeds?: number;
  earlyCheckInHours?: number;
  lateCheckOutHours?: number;
  discount?: { type: "PERCENT" | "FIXED"; value: Prisma.Decimal.Value } | null;
  taxPercent?: Prisma.Decimal.Value;
  serviceChargePercent?: Prisma.Decimal.Value;
  depositPercent?: Prisma.Decimal.Value;
}
export interface PriceLine {
  type: "ROOM" | "EXTRA_GUEST" | "EXTRA_BED" | "EARLY_CHECKIN" | "LATE_CHECKOUT" | "DISCOUNT" | "SERVICE_CHARGE" | "TAX";
  description: string;
  amount: string;
}
export interface PriceBreakdown {
  lines: PriceLine[];
  units: number;
  subtotal: string;
  discount: string;
  serviceCharge: string;
  tax: string;
  total: string;
  deposit: string;
}

/** Local calendar date (YYYY-MM-DD) and weekday for an instant in a timezone. */
export function localDate(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d); // en-CA => YYYY-MM-DD
  const [y, m, day] = parts.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return { iso: parts, weekday };
}
const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

function dayRate(iso: string, i: PriceInput, weekendDays: number[]) {
  const r = i.rate;
  let base = D(weekendDays.includes(weekdayOf(iso)) ? r.weekendRate : r.weekdayRate);
  if (i.holidays?.includes(iso) && r.holidayRate != null) base = D(r.holidayRate);
  const season = (i.seasons ?? [])
    .filter((s) => s.startDate <= iso && iso <= s.endDate)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return { rate: season ? base.mul(season.multiplier) : base, season: season?.name };
}

export function calculatePrice(i: PriceInput): PriceBreakdown {
  if (i.endAt <= i.startAt) throw new Error("endAt must be after startAt");
  const lines: PriceLine[] = [];
  const weekendDays = i.weekendDays ?? [5, 6];
  const startLocal = localDate(i.startAt, i.timezone).iso;
  let room = D(0);
  let units = 1;

  if (i.kind === "HOURLY") {
    const hours = Math.max(i.minHours ?? 1, Math.ceil((i.endAt.getTime() - i.startAt.getTime()) / 36e5));
    units = hours;
    const { rate, season } = dayRate(startLocal, i, weekendDays);
    room = rate.mul(hours);
    lines.push({ type: "ROOM", description: `${hours} hour(s) × ${round2(rate)}${season ? ` (${season})` : ""}`, amount: round2(room).toString() });
  } else if (i.kind === "DAY_USE") {
    const { rate, season } = dayRate(startLocal, i, weekendDays);
    room = rate;
    lines.push({ type: "ROOM", description: `Day use${season ? ` (${season})` : ""}`, amount: round2(room).toString() });
  } else {
    const endLocal = localDate(i.endAt, i.timezone).iso;
    let nights = 0;
    for (let d = startLocal; d < endLocal; d = addDaysIso(d, 1)) {
      nights++;
      const { rate, season } = dayRate(d, i, weekendDays);
      room = room.plus(rate);
      lines.push({ type: "ROOM", description: `Night of ${d}${season ? ` (${season})` : ""}`, amount: round2(rate).toString() });
    }
    if (nights < 1) throw new Error("Overnight stay must span at least one night");
    units = nights;
    const md = D(i.rate.multiNightDiscountPercent ?? 0);
    if (nights >= 2 && md.gt(0)) {
      const off = room.mul(md).div(100);
      room = room.minus(off);
      lines.push({ type: "DISCOUNT", description: `Multi-night discount ${md}%`, amount: round2(off).neg().toString() });
    }
  }

  let subtotal = round2(room);
  const add = (type: PriceLine["type"], description: string, amt: Prisma.Decimal) => {
    const a = round2(amt);
    if (a.gt(0)) { lines.push({ type, description, amount: a.toString() }); subtotal = subtotal.plus(a); }
  };

  const extraAdults = Math.max(0, i.adults - i.rate.includedAdults);
  add("EXTRA_GUEST", `${extraAdults} extra adult(s) × ${units}`, D(i.rate.extraAdultFee).mul(extraAdults).mul(i.kind === "OVERNIGHT" ? units : 1));
  add("EXTRA_GUEST", `${i.children} child(ren) × ${units}`, D(i.rate.extraChildFee).mul(i.children).mul(i.kind === "OVERNIGHT" ? units : 1));
  add("EXTRA_BED", `${i.extraBeds ?? 0} extra bed(s)`, D(i.rate.extraBedFee).mul(i.extraBeds ?? 0).mul(i.kind === "OVERNIGHT" ? units : 1));
  add("EARLY_CHECKIN", `Early check-in ${i.earlyCheckInHours ?? 0}h`, D(i.rate.earlyCheckInFeePerHour ?? 0).mul(i.earlyCheckInHours ?? 0));
  add("LATE_CHECKOUT", `Late check-out ${i.lateCheckOutHours ?? 0}h`, D(i.rate.lateCheckOutFeePerHour ?? 0).mul(i.lateCheckOutHours ?? 0));

  let discount = D(0);
  if (i.discount) {
    discount = i.discount.type === "PERCENT" ? subtotal.mul(i.discount.value).div(100) : D(i.discount.value);
    discount = round2(Prisma.Decimal.min(discount, subtotal));
    if (discount.gt(0)) lines.push({ type: "DISCOUNT", description: "Discount", amount: discount.neg().toString() });
  }
  const taxable = subtotal.minus(discount);
  const serviceCharge = round2(taxable.mul(i.serviceChargePercent ?? 0).div(100));
  if (serviceCharge.gt(0)) lines.push({ type: "SERVICE_CHARGE", description: `Service charge ${D(i.serviceChargePercent ?? 0)}%`, amount: serviceCharge.toString() });
  const tax = round2(taxable.plus(serviceCharge).mul(i.taxPercent ?? 0).div(100));
  if (tax.gt(0)) lines.push({ type: "TAX", description: `Tax ${D(i.taxPercent ?? 0)}%`, amount: tax.toString() });
  const total = taxable.plus(serviceCharge).plus(tax);
  const deposit = round2(total.mul(i.depositPercent ?? 0).div(100));

  return {
    lines, units,
    subtotal: subtotal.toString(), discount: discount.toString(),
    serviceCharge: serviceCharge.toString(), tax: tax.toString(),
    total: total.toString(), deposit: deposit.toString(),
  };
}

/** Cancellation charge from policy tiers: [{hoursBefore, chargePercent}], strictest matching tier wins. */
export function cancellationCharge(
  total: Prisma.Decimal.Value, startAt: Date, now: Date,
  policy: { hoursBefore: number; chargePercent: number }[],
) {
  const hoursLeft = (startAt.getTime() - now.getTime()) / 36e5;
  const applicable = policy.filter((t) => hoursLeft < t.hoursBefore).sort((a, b) => b.chargePercent - a.chargePercent)[0];
  return round2(D(total).mul(applicable?.chargePercent ?? 0).div(100));
}

