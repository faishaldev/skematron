"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readDatabase, snapshotStore } from "../lib/server.ts";

/** Reads one schema (read-only) and saves it as an immutable snapshot file. */
export async function saveSnapshot(formData: FormData): Promise<void> {
  const namespace = formData.get("namespace");
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new Error("Missing schema name.");
  }
  const { snapshot, serverVersion } = await readDatabase([namespace]);
  const record = await snapshotStore().save(snapshot, {
    namespace,
    source: `PostgreSQL ${serverVersion}`,
  });
  revalidatePath("/");
  redirect(`/?saved=${encodeURIComponent(record.id)}`);
}
