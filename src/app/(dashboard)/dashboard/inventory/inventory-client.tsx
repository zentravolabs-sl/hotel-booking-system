"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownUp, Boxes, History, Plus, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PropertySelect, useProperties, usePropertySelection } from "@/components/property-select";
import { api, ApiError, money } from "@/lib/utils";

interface ProductRow {
  id: string; sku: string; name: string; unit: string; minStock: string; avgCost: string; isIngredient: boolean;
  onHand: string; valuation: string; isLow: boolean;
  category: { id: string; name: string } | null;
}
interface StockTxRow {
  id: string; type: "RECEIVE" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: string; unitCost: string | null; reference: string | null; note: string | null; createdAt: string;
  product: { sku: string; name: string; unit: string };
}
interface SupplierRow { id: string; name: string; phone: string | null; email: string | null }
interface PurchaseOrderRow {
  id: string; number: string; status: string; total: string; createdAt: string;
  supplier: { id: string; name: string };
}
interface InventorySnapshot {
  items: ProductRow[];
  totalValuation: string;
  lowStockCount: number;
  transactions: StockTxRow[];
  suppliers: SupplierRow[];
  purchaseOrders: PurchaseOrderRow[];
}

export function InventoryClient() {
  const qc = useQueryClient();
  const props = useProperties();
  const [pid, setPid] = usePropertySelection(props.data);
  const [tab, setTab] = useState<"stock" | "ledger" | "suppliers">("stock");
  const currency = props.data?.find((p) => p.id === pid)?.currency ?? "LKR";

  const snap = useQuery({
    enabled: !!pid,
    queryKey: ["inventory", pid],
    queryFn: async () => (await api<InventorySnapshot>(`/api/inventory?propertyId=${pid}`)).data,
  });

  // New Product form
  const [sku, setSku] = useState("");
  const [pName, setPName] = useState("");
  const [pCat, setPCat] = useState("Housekeeping");
  const [unit, setUnit] = useState("pcs");
  const [minStock, setMinStock] = useState("10");
  const [avgCost, setAvgCost] = useState("0");
  const [isIng, setIsIng] = useState(false);

  const addProduct = useMutation({
    mutationFn: () =>
      api("/api/inventory", {
        method: "POST",
        body: {
          action: "product",
          sku,
          name: pName,
          categoryName: pCat || undefined,
          unit,
          minStock: Number(minStock) || 0,
          avgCost: Number(avgCost) || 0,
          isIngredient: isIng,
        },
      }),
    onSuccess: () => {
      setSku(""); setPName("");
      qc.invalidateQueries({ queryKey: ["inventory", pid] });
    },
  });

  // Stock transaction form
  const [txProd, setTxProd] = useState("");
  const [txType, setTxType] = useState<"RECEIVE" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT">("RECEIVE");
  const [txQty, setTxQty] = useState("");
  const [txCost, setTxCost] = useState("");
  const [txRef, setTxRef] = useState("");
  const [txErr, setTxErr] = useState<string | null>(null);

  const recordTx = useMutation({
    mutationFn: () =>
      api("/api/inventory", {
        method: "POST",
        body: {
          action: "transaction",
          propertyId: pid,
          productId: txProd || snap.data?.items[0]?.id,
          type: txType,
          quantity: Number(txQty),
          ...(txCost ? { unitCost: Number(txCost) } : {}),
          reference: txRef || undefined,
        },
      }),
    onSuccess: () => {
      setTxQty(""); setTxCost(""); setTxRef(""); setTxErr(null);
      qc.invalidateQueries({ queryKey: ["inventory", pid] });
    },
    onError: (e) => setTxErr(e instanceof ApiError ? e.message : "Transaction failed"),
  });

  // Supplier & PO form
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const addSup = useMutation({
    mutationFn: () => api("/api/inventory", { method: "POST", body: { action: "supplier", name: sName, phone: sPhone || undefined } }),
    onSuccess: () => { setSName(""); setSPhone(""); qc.invalidateQueries({ queryKey: ["inventory", pid] }); },
  });

  const [poSup, setPoSup] = useState("");
  const [poProd, setPoProd] = useState("");
  const [poQty, setPoQty] = useState("25");
  const [poCost, setPoCost] = useState("500");
  const addPo = useMutation({
    mutationFn: () => {
      const prod = snap.data?.items.find((i) => i.id === (poProd || snap.data?.items[0]?.id));
      return api("/api/inventory", {
        method: "POST",
        body: {
          action: "purchase_order",
          propertyId: pid,
          supplierId: poSup || snap.data?.suppliers[0]?.id,
          lines: [{ productId: prod!.id, name: prod!.name, quantity: Number(poQty), unitCost: Number(poCost) }],
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", pid] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory &amp; Stock Management</h1>
          <p className="text-sm text-muted">Products, restaurant ingredients, minimum stock alerts, valuation and immutable stock transaction ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          {props.data && <PropertySelect props={props.data} value={pid} onChange={setPid} />}
        </div>
      </div>

      {snap.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-xs text-muted">Total Inventory Valuation</p>
            <p className="mt-1 text-2xl font-semibold text-teal">{money(snap.data.totalValuation, currency)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-muted">Active SKUs</p>
            <p className="mt-1 text-2xl font-semibold">{snap.data.items.length}</p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-muted">Minimum Stock Alerts</p>
            <p className={`mt-1 text-2xl font-semibold ${snap.data.lowStockCount > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {snap.data.lowStockCount} low item(s)
            </p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {([
          { k: "stock", label: "Products & Stock Movements", icon: Boxes },
          { k: "ledger", label: "Immutable Transaction Ledger", icon: History },
          { k: "suppliers", label: "Suppliers & Purchase Orders", icon: Truck },
        ] as const).map((t) => (
          <button
            key={t.k} onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.k ? "bg-teal text-white" : "text-muted hover:bg-surface-2"}`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {snap.error && <ErrorState message={(snap.error as Error).message} onRetry={() => snap.refetch()} />}
      {snap.isLoading && <Skeleton className="h-64" />}

      {tab === "stock" && snap.data && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="space-y-3 p-5">
              <h3 className="font-semibold">Create Product / Ingredient SKU</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="SKU *"><Input placeholder="LIN-TOWEL-01" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} /></Field>
                <Field label="Name *" className="sm:col-span-2"><Input placeholder="Egyptian Cotton Bath Towel" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
                <Field label="Category"><Input value={pCat} onChange={(e) => setPCat(e.target.value)} /></Field>
                <Field label="Unit"><Input placeholder="pcs / kg / L" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
                <Field label="Min stock alert"><Input type="number" step="0.1" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox label="Restaurant kitchen ingredient" checked={isIng} onChange={(e) => setIsIng(e.target.checked)} />
                <Field label={`Initial unit cost (${currency})`} className="w-40">
                  <Input type="number" step="0.01" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} />
                </Field>
                <Button disabled={!sku.trim() || pName.trim().length < 2} loading={addProduct.isPending} onClick={() => addProduct.mutate()}>
                  <Plus className="size-4" /> Add Product
                </Button>
              </div>
            </Card>

            <Card className="space-y-3 p-5">
              <h3 className="font-semibold">Record Stock Movement (Receive / Issue / Adjust)</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Product">
                  <Select value={txProd || snap.data.items[0]?.id || ""} onChange={(e) => setTxProd(e.target.value)}>
                    {snap.data.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} ({Number(p.onHand)} {p.unit})</option>)}
                  </Select>
                </Field>
                <Field label="Movement type">
                  <Select value={txType} onChange={(e) => setTxType(e.target.value as typeof txType)}>
                    <option value="RECEIVE">Receive Stock (+)</option>
                    <option value="ISSUE">Issue / Consume (-)</option>
                    <option value="ADJUSTMENT">Stock Adjustment (+/-)</option>
                    <option value="TRANSFER_IN">Transfer In (+)</option>
                    <option value="TRANSFER_OUT">Transfer Out (-)</option>
                  </Select>
                </Field>
                <Field label="Quantity *"><Input type="number" step="0.001" value={txQty} onChange={(e) => setTxQty(e.target.value)} /></Field>
                <Field label={`Unit cost (${currency}, optional)`}><Input type="number" step="0.01" value={txCost} onChange={(e) => setTxCost(e.target.value)} /></Field>
              </div>
              <div className="flex items-end gap-3">
                <Field label="Reference / Note" className="flex-1"><Input placeholder="GRN-102 / Issued to Kitchen" value={txRef} onChange={(e) => setTxRef(e.target.value)} /></Field>
                <Button disabled={!snap.data.items.length || !Number(txQty)} loading={recordTx.isPending} onClick={() => { setTxErr(null); recordTx.mutate(); }}>
                  <ArrowDownUp className="size-4" /> Post Movement
                </Button>
              </div>
              {txErr && <p role="alert" className="text-xs font-medium text-danger">{txErr}</p>}
            </Card>
          </div>

          {snap.data.items.length === 0 ? (
            <EmptyState title="No inventory products" text="Add your first product or restaurant ingredient above." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {["SKU", "Product", "Category", "On Hand", "Min Alert", "Avg Cost", "Valuation", "Status"].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snap.data.items.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{p.sku}</td>
                      <td className="px-4 py-3 font-medium">
                        {p.name}
                        {p.isIngredient && <Badge tone="purple" className="ml-2">Ingredient</Badge>}
                      </td>
                      <td className="px-4 py-3 text-muted">{p.category?.name ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold">{Number(p.onHand)} {p.unit}</td>
                      <td className="px-4 py-3 text-muted">{Number(p.minStock)} {p.unit}</td>
                      <td className="px-4 py-3">{money(p.avgCost, currency)}</td>
                      <td className="px-4 py-3 font-medium">{money(p.valuation, currency)}</td>
                      <td className="px-4 py-3">
                        {p.isLow ? (
                          <Badge tone="amber"><AlertTriangle className="mr-1 size-3" />Low Stock</Badge>
                        ) : (
                          <Badge tone="green">Healthy</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "ledger" && snap.data && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4" />
            <span>Immutable Ledger: Enforced by PostgreSQL trigger <code>stock_tx_immutable</code> — rows cannot be modified or deleted.</span>
          </div>
          {snap.data.transactions.length === 0 ? (
            <p className="text-sm text-muted">No stock transactions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    {["Timestamp", "SKU / Product", "Type", "Signed Qty", "Unit Cost", "Reference"].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snap.data.transactions.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-xs text-muted">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 font-medium">{t.product.sku} · {t.product.name}</td>
                      <td className="px-4 py-3"><Badge tone={Number(t.quantity) >= 0 ? "green" : "amber"}>{t.type}</Badge></td>
                      <td className={`px-4 py-3 font-mono font-semibold ${Number(t.quantity) >= 0 ? "text-emerald-600" : "text-danger"}`}>
                        {Number(t.quantity) > 0 ? `+${Number(t.quantity)}` : Number(t.quantity)} {t.product.unit}
                      </td>
                      <td className="px-4 py-3">{t.unitCost ? money(t.unitCost, currency) : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{t.reference || t.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "suppliers" && snap.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Suppliers</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Supplier name *"><Input placeholder="Ceylon Hospitality Supplies" value={sName} onChange={(e) => setSName(e.target.value)} /></Field>
              <Field label="Phone"><Input value={sPhone} onChange={(e) => setSPhone(e.target.value)} /></Field>
              <Button disabled={sName.trim().length < 2} loading={addSup.isPending} onClick={() => addSup.mutate()}><Plus className="size-4" /> Add Supplier</Button>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {snap.data.suppliers.map((s) => (
                <li key={s.id} className="flex justify-between px-4 py-2.5">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted">{s.phone || "—"}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">Create Purchase Order</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier">
                <Select value={poSup || snap.data.suppliers[0]?.id || ""} onChange={(e) => setPoSup(e.target.value)}>
                  {snap.data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Product">
                <Select value={poProd || snap.data.items[0]?.id || ""} onChange={(e) => setPoProd(e.target.value)}>
                  {snap.data.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </Select>
              </Field>
              <Field label="Order Qty"><Input type="number" value={poQty} onChange={(e) => setPoQty(e.target.value)} /></Field>
              <Field label={`Unit Cost (${currency})`}><Input type="number" step="0.01" value={poCost} onChange={(e) => setPoCost(e.target.value)} /></Field>
            </div>
            <Button disabled={!snap.data.suppliers.length || !snap.data.items.length} loading={addPo.isPending} onClick={() => addPo.mutate()}>
              <Plus className="size-4" /> Issue Purchase Order
            </Button>

            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {snap.data.purchaseOrders.map((po) => (
                <li key={po.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="font-mono text-xs font-semibold">{po.number}</span> · {po.supplier.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="blue">{po.status}</Badge>
                    <span className="font-semibold">{money(po.total, currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

