import { redirect } from "next/navigation";
import { getInstallation } from "../../lib/membership.ts";
import { Flash, param, type SearchParams } from "../components/ui.tsx";
import { signInAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const installation = await getInstallation();
  if (installation?.status !== "complete") redirect("/setup");
  const next = param((await searchParams).next) ?? "/projects";
  return (
    <div className="narrow">
      <h1>Sign in to Skematron</h1>
      <Flash searchParams={searchParams} />
      <form action={signInAction} className="stack">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
      <p className="hint">New here? Ask an admin for an invitation link.</p>
    </div>
  );
}
