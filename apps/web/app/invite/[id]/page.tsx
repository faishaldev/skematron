import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth.ts";
import { findOpenInvitation, normalizeEmail } from "../../../lib/membership.ts";
import { Flash, type SearchParams } from "../../components/ui.tsx";
import { joinAction, signUpAndJoinAction } from "./actions.ts";
import { signOutAction } from "../../sign-out-action.ts";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const invitation = await findOpenInvitation(id);
  if (invitation === null) {
    return (
      <div className="narrow">
        <h1>Invitation not valid</h1>
        <p>
          This invitation is invalid, was already used, or has expired. Ask an
          admin for a new link.
        </p>
      </div>
    );
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const role = invitation.role ?? "member";

  if (session !== null) {
    const matches =
      normalizeEmail(session.user.email) === normalizeEmail(invitation.email);
    return (
      <div className="narrow">
        <h1>Join Skematron</h1>
        <Flash searchParams={searchParams} />
        {matches ? (
          <form action={joinAction} className="stack">
            <p>
              You were invited as <strong>{role}</strong>.
            </p>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <button type="submit" className="primary">
              Accept invitation
            </button>
          </form>
        ) : (
          <>
            <p>
              You are signed in as {session.user.email}, but this invitation is
              for {invitation.email}.
            </p>
            <form action={signOutAction}>
              <button type="submit">Sign out</button>
            </form>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>Join Skematron</h1>
      <p className="muted">
        You were invited as <strong>{role}</strong>. Create your account to
        join.
      </p>
      <Flash searchParams={searchParams} />
      <form action={signUpAndJoinAction} className="stack">
        <input type="hidden" name="invitationId" value={invitation.id} />
        <label>
          Email
          <input value={invitation.email} disabled />
        </label>
        <label>
          Your name
          <input name="name" required maxLength={80} autoComplete="name" />
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
          Create account and join
        </button>
      </form>
      <p className="hint">
        Already have an account?{" "}
        <Link
          href={`/sign-in?next=${encodeURIComponent(`/invite/${invitation.id}`)}`}
        >
          Sign in
        </Link>{" "}
        first, then open this link again.
      </p>
    </div>
  );
}
