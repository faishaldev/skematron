import { signOutAction } from "../sign-out-action.ts";

export default function NoAccessPage() {
  return (
    <div className="narrow">
      <h1>No access</h1>
      <p>
        Your account is not a member of this Skematron organization. Ask an
        admin for an invitation.
      </p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
