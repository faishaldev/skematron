"use server";

import { headers } from "next/headers";
import { field, runAction } from "../../lib/actions.ts";
import { auth } from "../../lib/auth.ts";

export async function signInAction(formData: FormData): Promise<void> {
  const next = field(formData, "next");
  await runAction("/sign-in", async () => {
    await auth.api.signInEmail({
      body: {
        email: field(formData, "email"),
        password: field(formData, "password"),
      },
      headers: await headers(),
    });
    // Only same-site paths, never an absolute URL (no open redirect).
    return next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  });
}
