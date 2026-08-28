/** Top-level presentation views managed by the Lupin shell. */
export type SystemViewId =
  | "COMMAND_DECK"
  | "FLEET_INVENTORY"
  | "AST_GOVERNANCE"
  | "INCIDENT_ARCHIVE"
  | "SCHEDULED_JOBS";

export const systemViewPaths: Record<SystemViewId, string> = {
  COMMAND_DECK: "/",
  FLEET_INVENTORY: "/fleet",
  AST_GOVERNANCE: "/governance",
  INCIDENT_ARCHIVE: "/archive",
  SCHEDULED_JOBS: "/automation",
};
