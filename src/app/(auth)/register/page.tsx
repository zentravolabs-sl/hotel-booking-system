"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/utils";

const schema = z.object({
  organizationName: z.string().trim().min(2, "At least 2 characters"),
  propertyName: z.string().trim().min(2, "At least 2 characters"),
  name: z.string().trim().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters").regex(/[a-z]/, "Add a lowercase letter").regex(/[A-Z]/, "Add an uppercase letter").regex(/\d/, "Add a number"),
});
type V = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(schema) });

  async function onSubmit(v: V) {
    setError(null);
    try {
      await api("/api/auth/register", { method: "POST", body: v });
      await api("/api/auth/login", { method: "POST", body: { email: v.email, password: v.password } });
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create your account");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h2 className="text-2xl font-semibold">Start your 14-day trial</h2>
        <p className="mt-1 text-sm text-muted">No card required.</p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-danger dark:bg-red-950/40">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" error={errors.organizationName?.message}><Input {...register("organizationName")} /></Field>
        <Field label="First property" error={errors.propertyName?.message}><Input placeholder="e.g. Blue Lagoon Cabanas" {...register("propertyName")} /></Field>
      </div>
      <Field label="Your name" error={errors.name?.message}><Input autoComplete="name" {...register("name")} /></Field>
      <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register("email")} /></Field>
      <Field label="Password" error={errors.password?.message} hint="10+ characters with upper, lower case and a number"><Input type="password" autoComplete="new-password" {...register("password")} /></Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      <p className="text-center text-sm text-muted">Already registered? <Link href="/login" className="font-medium text-teal hover:underline">Sign in</Link></p>
    </form>
  );
}

