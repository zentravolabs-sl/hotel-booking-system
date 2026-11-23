import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";

export interface PaymentCheckoutSession {
  provider: string;
  actionUrl: string;
  fields: Record<string, string>;
}

export interface WebhookNotification {
  merchant_id: string;
  order_id: string; // booking reference or payment id
  payment_id: string; // gateway payment reference
  payhere_amount: string;
  payhere_currency: string;
  status_code: string; // "2" = success, "0" = pending, "-1" = cancelled, "-2" = failed, "-3" = chargedback
  md5sig: string;
}

export interface PaymentProviderAdapter {
  readonly name: string;
  createCheckoutSession(params: {
    orderId: string;
    amount: Prisma.Decimal.Value;
    currency: string;
    itemTitle: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    returnUrl: string;
    cancelUrl: string;
    notifyUrl: string;
  }): PaymentCheckoutSession;
  verifyNotification(payload: WebhookNotification): {
    valid: boolean;
    status: "SUCCEEDED" | "PENDING" | "FAILED";
    providerRef: string;
    orderId: string;
    amount: Prisma.Decimal;
    currency: string;
  };
}

const md5Upper = (input: string) => createHash("md5").update(input).digest("hex").toUpperCase();

/**
 * PayHere (Sri Lanka) payment gateway adapter.
 * Checkout hash formula: UpperCase(MD5(merchant_id + order_id + amount_2dp + currency + UpperCase(MD5(merchant_secret))))
 * Notify md5sig formula: UpperCase(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UpperCase(MD5(merchant_secret))))
 */
export class PayHereAdapter implements PaymentProviderAdapter {
  readonly name = "PAYHERE";
  private readonly merchantId: string;
  private readonly merchantSecret: string;
  private readonly sandbox: boolean;

  constructor(opts?: { merchantId?: string; merchantSecret?: string; sandbox?: boolean }) {
    this.merchantId = opts?.merchantId ?? process.env.PAYHERE_MERCHANT_ID ?? "SANDBOX_MERCHANT";
    this.merchantSecret = opts?.merchantSecret ?? process.env.PAYHERE_MERCHANT_SECRET ?? "SANDBOX_SECRET";
    this.sandbox = opts?.sandbox ?? process.env.PAYHERE_SANDBOX !== "false";
  }

  computeCheckoutHash(orderId: string, amount: Prisma.Decimal.Value, currency: string): string {
    const formattedAmount = new Prisma.Decimal(amount).toFixed(2);
    const secretHash = md5Upper(this.merchantSecret);
    return md5Upper(`${this.merchantId}${orderId}${formattedAmount}${currency}${secretHash}`);
  }

  computeNotifySig(p: Omit<WebhookNotification, "md5sig">): string {
    const secretHash = md5Upper(this.merchantSecret);
    return md5Upper(
      `${p.merchant_id}${p.order_id}${p.payhere_amount}${p.payhere_currency}${p.status_code}${secretHash}`,
    );
  }

  createCheckoutSession(params: {
    orderId: string;
    amount: Prisma.Decimal.Value;
    currency: string;
    itemTitle: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    returnUrl: string;
    cancelUrl: string;
    notifyUrl: string;
  }): PaymentCheckoutSession {
    const amountStr = new Prisma.Decimal(params.amount).toFixed(2);
    const hash = this.computeCheckoutHash(params.orderId, amountStr, params.currency);
    return {
      provider: this.name,
      actionUrl: this.sandbox
        ? "https://sandbox.payhere.lk/pay/checkout"
        : "https://www.payhere.lk/pay/checkout",
      fields: {
        merchant_id: this.merchantId,
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        notify_url: params.notifyUrl,
        order_id: params.orderId,
        items: params.itemTitle,
        currency: params.currency,
        amount: amountStr,
        first_name: params.firstName,
        last_name: params.lastName,
        email: params.email,
        phone: params.phone,
        address: "Resort Booking",
        city: "Colombo",
        country: "Sri Lanka",
        hash,
      },
    };
  }

  verifyNotification(payload: WebhookNotification) {
    if (payload.merchant_id !== this.merchantId) {
      return {
        valid: false,
        status: "FAILED" as const,
        providerRef: payload.payment_id,
        orderId: payload.order_id,
        amount: new Prisma.Decimal(0),
        currency: payload.payhere_currency,
      };
    }
    const expected = this.computeNotifySig(payload);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from((payload.md5sig ?? "").toUpperCase(), "utf8");
    const valid = a.length === b.length && timingSafeEqual(a, b);

    const status: "SUCCEEDED" | "PENDING" | "FAILED" =
      payload.status_code === "2"
        ? "SUCCEEDED"
        : payload.status_code === "0"
          ? "PENDING"
          : "FAILED";

    return {
      valid,
      status,
      providerRef: payload.payment_id,
      orderId: payload.order_id,
      amount: new Prisma.Decimal(payload.payhere_amount || "0"),
      currency: payload.payhere_currency,
    };
  }
}

