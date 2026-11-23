"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, ChefHat, CheckCircle2, Flame, Minus, Plus, Printer, Receipt, ShoppingBag, UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface MenuItemRow { id: string; name: string; description: string | null; price: string; isAvailable: boolean }
interface MenuCategoryRow { id: string; name: string; items: MenuItemRow[] }
interface TableRow { id: string; label: string; seats: number }
interface OrderItemRow { id: string; menuItemId: string; name: string; quantity: number; unitPrice: string; notes: string | null }
interface FoodOrderRow {
  id: string; number: string; type: "DINE_IN" | "TAKEAWAY" | "ROOM_SERVICE";
  status: "PENDING" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
  tableId: string | null; bookingId: string | null; chargedToRoom: boolean;
  subtotal: string; discount: string; total: string; createdAt: string;
  items: OrderItemRow[];
}
interface InHouseBooking {
  id: string; reference: string;
  guest: { firstName: string; lastName: string };
  items: { cabana: { code: string; name: string } }[];
}

const ORDER_TONE: Record<string, "amber" | "blue" | "purple" | "green" | "gray" | "red"> = {
  PENDING: "amber", ACCEPTED: "blue", PREPARING: "purple", READY: "green", SERVED: "gray", CANCELLED: "red",
};

export function RestaurantClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"pos" | "kds" | "menu">("pos");
  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const feed = useQuery({
    enabled: !!pid,
    queryKey: ["restaurant", pid],
    queryFn: async () =>
      (await api<{
        categories: MenuCategoryRow[];
        tables: TableRow[];
        orders: FoodOrderRow[];
        inHouseBookings: InHouseBooking[];
      }>(`/api/restaurant?propertyId=${pid}`)).data,
  });

  // POS cart state
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "ROOM_SERVICE">("DINE_IN");
  const [tableId, setTableId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [chargeToRoom, setChargeToRoom] = useState(false);
  const [discount, setDiscount] = useState("0");
  const [cart, setCart] = useState<{ item: MenuItemRow; qty: number }[]>([]);
  const [orderErr, setOrderErr] = useState<string | null>(null);

  const addToCart = (item: MenuItemRow) =>
    setCart((c) => {
      const existing = c.find((x) => x.item.id === item.id);
      return existing ? c.map((x) => (x.item.id === item.id ? { ...x, qty: x.qty + 1 } : x)) : [...c, { item, qty: 1 }];
    });
  const changeQty = (id: string, delta: number) =>
    setCart((c) => c.map((x) => (x.item.id === id ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0));

  const subtotal = cart.reduce((acc, x) => acc + Number(x.item.price) * x.qty, 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));

  const submitOrder = useMutation({
    mutationFn: () =>
      api("/api/restaurant", {
        method: "POST",
        body: {
          action: "order",
          propertyId: pid,
          type: orderType,
          tableId: orderType === "DINE_IN" ? tableId || feed.data?.tables[0]?.id || null : null,
          bookingId: orderType === "ROOM_SERVICE" || chargeToRoom ? bookingId || feed.data?.inHouseBookings[0]?.id || null : null,
          chargeToRoom: orderType === "ROOM_SERVICE" || chargeToRoom,
          discount: Number(discount) || 0,
          items: cart.map((x) => ({ menuItemId: x.item.id, quantity: x.qty })),
        },
      }),
    onSuccess: () => {
      setCart([]); setDiscount("0"); setOrderErr(null);
      qc.invalidateQueries({ queryKey: ["restaurant", pid] });
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
    },
    onError: (e) => setOrderErr(e instanceof ApiError ? e.message : "Could not place order"),
  });

  const patchOrder = useMutation({
    mutationFn: (p: { orderId: string; status: FoodOrderRow["status"] }) =>
      api("/api/restaurant", { method: "PATCH", body: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurant", pid] });
      qc.invalidateQueries({ queryKey: ["frontdesk"] });
    },
  });

  // Menu & table setup state
  const [mCat, setMCat] = useState("Seafood & Grill");
  const [mName, setMName] = useState("");
  const [mPrice, setMPrice] = useState("");
  const [mDesc, setMDesc] = useState("");
  const addMenu = useMutation({
    mutationFn: () =>
      api("/api/restaurant", {
        method: "POST",
        body: { action: "menu_item", propertyId: pid, categoryName: mCat, name: mName, price: Number(mPrice), description: mDesc || undefined },
      }),
    onSuccess: () => { setMName(""); setMPrice(""); setMDesc(""); qc.invalidateQueries({ queryKey: ["restaurant", pid] }); },
  });

  const [tLabel, setTLabel] = useState("");
  const [tSeats, setTSeats] = useState("4");
  const addTable = useMutation({
    mutationFn: () =>
      api("/api/restaurant", {
        method: "POST",
        body: { action: "table", propertyId: pid, label: tLabel, seats: Number(tSeats) || 4 },
      }),
    onSuccess: () => { setTLabel(""); qc.invalidateQueries({ queryKey: ["restaurant", pid] }); },
  });

  const allItems = feed.data?.categories.flatMap((c) => c.items.map((it) => ({ ...it, categoryName: c.name }))) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Restaurant POS &amp; Kitchen Display</h1>
          <p className="text-sm text-muted">Dine-in, takeaway, cabana room service, guest folio charging and live kitchen tickets.</p>
        </div>
        <div className="flex items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "pos", label: "POS Billing Terminal", icon: Receipt },
          { k: "kds", label: "Kitchen Display (KDS)", icon: ChefHat },
          { k: "menu", label: "Menus & Tables", icon: UtensilsCrossed },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {feed.error && <ErrorState message={(feed.error as Error).message} onRetry={() => feed.refetch()} />}
      {feed.isLoading && <Skeleton className="h-72" />}

      {tab === "pos" && feed.data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {allItems.length === 0 ? (
              <EmptyState title="No menu items yet" text="Add menu items under the Menus & Tables tab to start taking orders." action={<Button onClick={() => setTab("menu")}>Set Up Menu</Button>} />
            ) : (
              feed.data.categories.map((cat) => (
                <div key={cat.id} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted">{cat.name}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {cat.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addToCart(item)}
                        className="flex flex-col justify-between rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-teal"
                      >
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.description}</p>}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-teal">{money(item.price, currency)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <Card className="flex flex-col justify-between space-y-4 p-5">
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 font-semibold"><ShoppingBag className="size-4 text-teal" /> Current Order</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Order type">
                  <Select value={orderType} onChange={(e) => setOrderType(e.target.value as typeof orderType)}>
                    <option value="DINE_IN">Dine-In</option>
                    <option value="TAKEAWAY">Takeaway</option>
                    <option value="ROOM_SERVICE">Cabana Room Service</option>
                  </Select>
                </Field>
                {orderType === "DINE_IN" && (
                  <Field label="Table">
                    <Select value={tableId || feed.data.tables[0]?.id || ""} onChange={(e) => setTableId(e.target.value)}>
                      <option value="">Counter / Walk-in</option>
                      {feed.data.tables.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.seats} seats)</option>)}
                    </Select>
                  </Field>
                )}
              </div>

              {orderType !== "ROOM_SERVICE" && (
                <Checkbox
                  label="Charge bill to an in-house guest cabana folio"
                  checked={chargeToRoom}
                  onChange={(e) => setChargeToRoom(e.target.checked)}
                />
              )}

              {(orderType === "ROOM_SERVICE" || chargeToRoom) && (
                <Field label="Checked-In Guest Folio *">
                  <Select value={bookingId || feed.data.inHouseBookings[0]?.id || ""} onChange={(e) => setBookingId(e.target.value)}>
                    {feed.data.inHouseBookings.length === 0 && <option value="">No checked-in guests available</option>}
                    {feed.data.inHouseBookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.items.map((i) => i.cabana.code).join(", ")} · {b.guest.firstName} {b.guest.lastName} ({b.reference})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {cart.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">Tap menu items to add them to the order.</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {cart.map((c) => (
                    <li key={c.item.id} className="flex items-center justify-between px-3 py-2.5">
                      <div>
                        <p className="font-medium">{c.item.name}</p>
                        <p className="text-xs text-muted">{money(c.item.price, currency)} × {c.qty}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => changeQty(c.item.id, -1)} className="rounded-lg border border-border p-1 hover:bg-surface-2"><Minus className="size-3.5" /></button>
                        <span className="w-6 text-center font-semibold">{c.qty}</span>
                        <button type="button" onClick={() => changeQty(c.item.id, 1)} className="rounded-lg border border-border p-1 hover:bg-surface-2"><Plus className="size-3.5" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-4 text-sm">
              <Field label={`Discount (${currency})`}>
                <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <div className="flex justify-between text-muted"><span>Subtotal</span><span>{money(subtotal, currency)}</span></div>
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span><span className="text-teal">{money(total, currency)}</span>
              </div>
              {orderErr && <p role="alert" className="text-xs font-medium text-danger">{orderErr}</p>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => window.print()} disabled={!cart.length}><Printer className="size-4" /></Button>
                <Button
                  className="flex-1"
                  disabled={!cart.length || ((orderType === "ROOM_SERVICE" || chargeToRoom) && !feed.data.inHouseBookings.length)}
                  loading={submitOrder.isPending}
                  onClick={() => { setOrderErr(null); submitOrder.mutate(); }}
                >
                  Send to Kitchen
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "kds" && feed.data && (
        feed.data.orders.length === 0 ? (
          <EmptyState title="No kitchen orders" text="Orders placed at the POS terminal appear here in real time." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {feed.data.orders.map((o) => (
              <Card key={o.id} className="flex flex-col justify-between space-y-3 p-5 text-sm">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{o.number}</span>
                    <div className="flex gap-1.5">
                      <Badge>{o.type}</Badge>
                      {o.chargedToRoom && <Badge tone="purple">Room Charge</Badge>}
                      <Badge tone={ORDER_TONE[o.status]}>{o.status}</Badge>
                    </div>
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border bg-surface-2/40 px-3 py-1">
                    {o.items.map((it) => (
                      <li key={it.id} className="flex justify-between py-1.5">
                        <span><b>{it.quantity}×</b> {it.name}</span>
                        <span className="text-xs text-muted">{money(Number(it.unitPrice) * it.quantity, currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between font-semibold">
                    <span>Total</span><span>{money(o.total, currency)}</span>
                  </div>
                </div>

                {!["SERVED", "CANCELLED"].includes(o.status) && (
                  <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                    {o.status === "PENDING" && (
                      <Button size="sm" variant="secondary" onClick={() => patchOrder.mutate({ orderId: o.id, status: "ACCEPTED" })}>
                        Accept
                      </Button>
                    )}
                    {(o.status === "PENDING" || o.status === "ACCEPTED") && (
                      <Button size="sm" variant="secondary" onClick={() => patchOrder.mutate({ orderId: o.id, status: "PREPARING" })}>
                        <Flame className="size-3.5" /> Preparing
                      </Button>
                    )}
                    {o.status === "PREPARING" && (
                      <Button size="sm" onClick={() => patchOrder.mutate({ orderId: o.id, status: "READY" })}>
                        <CheckCircle2 className="size-3.5" /> Ready
                      </Button>
                    )}
                    {o.status === "READY" && (
                      <Button size="sm" onClick={() => patchOrder.mutate({ orderId: o.id, status: "SERVED" })}>
                        Mark Served
                      </Button>
                    )}
                    <Button size="sm" variant="danger" className="ml-auto" onClick={() => patchOrder.mutate({ orderId: o.id, status: "CANCELLED" })}>
                      <Ban className="size-3.5" /> Cancel
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "menu" && feed.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Add Menu Item</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category"><Input value={mCat} onChange={(e) => setMCat(e.target.value)} placeholder="Seafood / Beverages" /></Field>
              <Field label="Item name *"><Input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Grilled Jumbo Prawns" /></Field>
              <Field label={`Price (${currency}) *`}><Input type="number" step="0.01" value={mPrice} onChange={(e) => setMPrice(e.target.value)} /></Field>
              <Field label="Description"><Input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="Garlic butter, lemon herb rice" /></Field>
            </div>
            <Button disabled={mName.trim().length < 2 || !Number(mPrice)} loading={addMenu.isPending} onClick={() => addMenu.mutate()}>
              <Plus className="size-4" /> Add Item
            </Button>
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Restaurant Tables</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Table label"><Input placeholder="T-01 / Beach Deck 2" value={tLabel} onChange={(e) => setTLabel(e.target.value)} /></Field>
              <Field label="Seats"><Input type="number" min={1} max={40} value={tSeats} onChange={(e) => setTSeats(e.target.value)} className="w-24" /></Field>
              <Button disabled={!tLabel.trim()} loading={addTable.isPending} onClick={() => addTable.mutate()}><Plus className="size-4" /> Add Table</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {feed.data.tables.map((t) => (
                <Badge key={t.id} tone="blue">{t.label} · {t.seats} seats</Badge>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

