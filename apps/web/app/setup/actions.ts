"use server";

import { field, runAction } from "../../lib/actions.ts";
import { runSetup } from "../../lib/setup.ts";

export async function setupAction(formData: FormData): Promise<void> {
  await runAction("/setup", async () => {
    await runSetup({
      organizationName: field(formData, "organizationName"),
      name: field(formData, "name"),
      email: field(formData, "email"),
      password: field(formData, "password"),
    });
    return "/projects";
  });
}
