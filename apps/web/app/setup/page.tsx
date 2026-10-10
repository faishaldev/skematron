import Link from "next/link";
import { getInstallation } from "../../lib/membership.ts";
import { Flash, type SearchParams } from "../components/ui.tsx";
import { setupAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const installation = await getInstallation();
  if (installation?.status === "complete") {
    return (
      <div className="narrow">
        <h1>Skematron is set up</h1>
        <p>
          Setup is complete. <Link href="/sign-in">Sign in</Link>, or ask an
          admin for an invitation.
        </p>
      </div>
    );
  }
  return (
    <div className="narrow">
      <h1>Set up Skematron</h1>
      <p className="muted">
        Create your organization and its owner account. After this, people join
        by invitation only.
      </p>
      <Flash searchParams={searchParams} />
      <form action={setupAction} className="stack">
        <label>
          Organization name
          <input name="organizationName" required maxLength={80} />
        </label>
        <label>
          Your name
          <input name="name" required maxLength={80} autoComplete="name" />
        </label>
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
            minLength={12}
            autoComplete="new-password"
          />
          <span className="hint">At least 12 characters.</span>
        </label>
        <button type="submit" className="primary">
          Create organization
        </button>
      </form>
    </div>
  );
}
