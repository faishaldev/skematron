import { isEmptyPlan, type MigrationPlan, type Risk } from "@skematron/core";
import { renderPostgresMigration } from "@skematron/adapters";
import { RiskBadge } from "./ui.tsx";

/** A migration plan for review: risk summary, unsupported changes, statements, full script. */
export function PlanView({
  plan,
  emptyMessage,
}: {
  plan: MigrationPlan;
  emptyMessage: string;
}) {
  if (isEmptyPlan(plan)) {
    return <div className="card notice">{emptyMessage}</div>;
  }
  const { statements, script } = renderPostgresMigration(plan);
  const count = (risk: Risk) =>
    statements.filter((statement) => statement.risk === risk).length;
  return (
    <>
      <p>
        {statements.length} operations: <RiskBadge risk="destructive" />{" "}
        {count("destructive")} · <RiskBadge risk="caution" /> {count("caution")}{" "}
        · <RiskBadge risk="safe" /> {count("safe")}
      </p>
      {plan.unsupported.length > 0 && (
        <div className="card error">
          <h3>Incomplete plan</h3>
          <p>
            These changes cannot be expressed as a migration and need manual
            work:
          </p>
          <ul>
            {plan.unsupported.map((change) => (
              <li key={`${change.object}:${change.reason}`}>
                <code>{change.object}</code>: {change.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Risk</th>
              <th>Statement</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement, index) => (
              <tr key={index}>
                <td>
                  <RiskBadge risk={statement.risk} />
                </td>
                <td>
                  <pre>{statement.sql}</pre>
                  {statement.warnings.length > 0 && (
                    <p className="muted">{statement.warnings.join(" ")}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Full script</h2>
      <p className="muted">For review only. Skematron does not execute it.</p>
      <pre>{script}</pre>
    </>
  );
}
