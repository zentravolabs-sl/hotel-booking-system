"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/utils";
import { Select } from "@/components/ui/field";

export interface PropertyDTO {
  id: string; name: string; city: string | null; address: string | null; phone: string | null; email: string | null;
  timezone: string; currency: string; description: string | null; isPublic: boolean; cabanaCount: number;
  settings: {
    checkInTime: string; checkOutTime: string; turnaroundMinutes: number; holdMinutes: number; taxPercent: string;
    serviceChargePercent: string; depositPercent: string; minHours: number; requireInspection: boolean;
  } | null;
}

export const useProperties = () => useQuery({ queryKey: ["properties"], queryFn: async () => (await api<PropertyDTO[]>("/api/properties")).data });

/** Selected-property state, defaulting to the first property and persisted in localStorage. */
export function usePropertySelection(props: PropertyDTO[] | undefined) {
  const [chosen, setChosen] = useState<string>("");
  // Derived during render (props only exist client-side, after the query resolves).
  const saved = props && typeof window !== "undefined" ? localStorage.getItem("cp_property") : null;
  const id = props?.find((p) => p.id === chosen)?.id ?? props?.find((p) => p.id === saved)?.id ?? props?.[0]?.id ?? "";
  const select = (v: string) => { setChosen(v); localStorage.setItem("cp_property", v); };
  return [id, select] as const;
}

export function PropertySelect({ props, value, onChange }: { props: PropertyDTO[]; value: string; onChange: (v: string) => void }) {
  if (props.length <= 1) return <span className="text-sm font-medium text-muted">{props[0]?.name}</span>;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Property" className="w-56">
      {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}

