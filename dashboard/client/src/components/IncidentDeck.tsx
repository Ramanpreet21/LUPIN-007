import { useState } from "react";
import { CheckCircle2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import type { UseControlPlaneReturn } from "@/hooks/useControlPlane";
import type { ApprovalDecision, IncidentDeckStatus } from "@/types/control-plane";
import "./IncidentDeck.css";

const STATUS_LABEL: Record<IncidentDeckStatus, string> = {
  diagnosing: "diagnosing",
  awaiting_approval: "review required",
  approved: "approved",
  rejected: "rejected",
  completed: "completed",
  failed: "failed",
};

const CONNECTION_LABEL = {
  CONNECTING: "connecting",
  CONNECTED: "live",
  DISCONNECTED: "offline",
  ERROR: "error",
} as const;

/**
 * Incident deck (blueprint §7): renders the live incident plane — proposed
 * commands, safety badges, and diff for each approval gate — and lets the
 * operator approve or reject. Decisions POST to /api/approvals via the plane.
 */
export function IncidentDeck({ plane }: { plane: UseControlPlaneReturn }) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [decisionError, setDecisionError] = useState<Record<string, string>>({});

  const decide = async (incidentId: string, decision: ApprovalDecision) => {
    setBusy((current) => ({ ...current, [incidentId]: true }));
    setDecisionError((current) => ({ ...current, [incidentId]: "" }));
    try {
      if (decision === "approved") await plane.approve(incidentId);
      else await plane.reject(incidentId);
    } catch (error) {
      setDecisionError((current) => ({
        ...current,
        [incidentId]: error instanceof Error ? error.message : "approval request failed",
      }));
    } finally {
      setBusy((current) => ({ ...current, [incidentId]: false }));
    }
  };

  const tone = plane.status.toLowerCase();

  return (
    <article className="incident-deck glass-surface" aria-label="Live incident deck">
      <div className="module-heading incident-deck-heading">
        <p className="eyebrow">Incident deck</p>
        <span className={`deck-status deck-status--${tone}`}>
          <i />
          {CONNECTION_LABEL[plane.status]}
        </span>
      </div>

      {plane.incidents.length === 0 ? (
        <p className="incident-deck-empty">Awaiting alert ingestion…</p>
      ) : (
        <div className="incident-list" aria-label="Live incidents">
          {plane.incidents.map((incident) => (
            <article
              className={`incident-card incident-card--${incident.status}`}
              key={incident.incident_id}
            >
              <header className="incident-card-head">
                <code className="incident-id">{incident.incident_id}</code>
                <em className={`incident-status incident-status--${incident.status}`}>
                  {STATUS_LABEL[incident.status]}
                </em>
              </header>

              {incident.thinking[incident.thinking.length - 1] && (
                <p className="incident-thought">
                  {incident.thinking[incident.thinking.length - 1]}
                </p>
              )}

              {incident.pending ? (
                <div className="approval-panel">
                  <div className="approval-commands">
                    {incident.pending.proposed_commands.map((command, index) => (
                      <code key={`${incident.incident_id}-cmd-${index}`}>{command}</code>
                    ))}
                  </div>

                  {incident.pending.diff && (
                    <pre className="approval-diff">{incident.pending.diff}</pre>
                  )}

                  <div className="approval-badges">
                    {incident.pending.safety_badges.map((badge) => (
                      <span key={badge.name} className={`safety-badge safety-badge--${badge.status}`}>
                        {badge.status === "fail" ? (
                          <TriangleAlert size={11} />
                        ) : (
                          <ShieldCheck size={11} />
                        )}
                        {badge.name}
                      </span>
                    ))}
                  </div>

                  {decisionError[incident.incident_id] && (
                    <p className="approval-error">{decisionError[incident.incident_id]}</p>
                  )}

                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-button approval-button--approve"
                      disabled={Boolean(busy[incident.incident_id])}
                      onClick={() => void decide(incident.incident_id, "approved")}
                    >
                      <CheckCircle2 size={12} />
                      Approve
                    </button>
                    <button
                      type="button"
                      className="approval-button approval-button--reject"
                      disabled={Boolean(busy[incident.incident_id])}
                      onClick={() => void decide(incident.incident_id, "rejected")}
                    >
                      <XCircle size={12} />
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </article>
  );
}
