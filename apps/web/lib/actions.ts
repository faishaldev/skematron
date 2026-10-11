// Shared shape of every server action: do the work, then redirect, either to where the
// work says, or back with a safe ?error= message. Next.js redirects (for example to
// /sign-in) are rethrown, never swallowed.
import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { messageFor, UserFacingError } from "./errors.ts";

export function withFlash(
  path: string,
  kind: "notice" | "error",
  message: string,
): string {
  const url = new URL(path, "http://localhost");
  url.searchParams.set(kind, message);
  return `${url.pathname}${url.search}`;
}

export async function runAction(
  backTo: string,
  work: () => Promise<string>,
): Promise<never> {
  let destination: string;
  try {
    destination = await work();
  } catch (error) {
    unstable_rethrow(error);
    destination = withFlash(backTo, "error", messageFor(error));
  }
  redirect(destination);
}

export const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** The chosen file (`schemaFile`) if there is one, else the pasted text (`schemaText`). */
export async function uploadedText(
  formData: FormData,
  maxBytes: number,
): Promise<string> {
  const file = formData.get("schemaFile");
  if (!(file instanceof File) || file.size === 0) {
    return field(formData, "schemaText");
  }
  if (file.size > maxBytes) {
    const limit =
      maxBytes >= 1024 * 1024
        ? `${maxBytes / 1024 / 1024} MB`
        : `${maxBytes / 1024} KB`;
    throw new UserFacingError(`The file is larger than ${limit}.`);
  }
  return file.text();
}
