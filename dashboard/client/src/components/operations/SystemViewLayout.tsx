import "./operations-views.css";
import { ArchiveView } from "./ArchiveView";
import { AutomationView } from "./AutomationView";
import { FleetView } from "./FleetView";
import { GovernanceView } from "./GovernanceView";
import { useFleetManager } from "@/hooks/useFleetManager";
import { useIncidentArchive } from "@/hooks/useIncidentArchive";
import { useJobScheduler } from "@/hooks/useJobScheduler";
import { usePolicyEngine } from "@/hooks/usePolicyEngine";
import type { SystemViewId } from "@/types/system-views";

/** Central presentation controller for all non-command-deck top-level views. */
export function SystemViewLayout({ activeViewId }: { activeViewId: Exclude<SystemViewId, "COMMAND_DECK"> }) {
  const fleet = useFleetManager();
  const policy = usePolicyEngine();
  const archive = useIncidentArchive();
  const scheduler = useJobScheduler();

  if (activeViewId === "FLEET_INVENTORY") return <FleetView nodes={fleet.nodes} query={fleet.query} environment={fleet.environment} selectedNode={fleet.selectedNode} notice={fleet.notice} onQueryChange={fleet.setQuery} onEnvironmentChange={fleet.setEnvironment} onSelectNode={fleet.setSelectedNode} onRegisterTarget={fleet.onRegisterTarget} onConnectSubshell={fleet.onConnectSubshell} onSpawnTwin={fleet.onSpawnTwin} onHealthCheck={fleet.onHealthCheck} />;
  if (activeViewId === "AST_GOVERNANCE") return <GovernanceView profile={policy.profile} profiles={policy.profiles} mode={policy.mode} rules={policy.rules} stats={policy.stats} expandedRuleId={policy.expandedRuleId} editorOpen={policy.editorOpen} notice={policy.notice} astSimulation={policy.astSimulation} onProfileChange={policy.onProfileChange} onModeChange={policy.setMode} onExpandRule={policy.setExpandedRuleId} onToggleRule={policy.onToggleRule} onOpenEditor={policy.setEditorOpen} onSaveRule={policy.onSaveRule} onAnalyze={policy.onAnalyze} />;
  if (activeViewId === "INCIDENT_ARCHIVE") return <ArchiveView incidents={archive.incidents} query={archive.query} severity={archive.severity} dateRange={archive.dateRange} selectedIncident={archive.selectedIncident} replayTab={archive.replayTab} notice={archive.notice} onQueryChange={archive.setQuery} onSeverityChange={archive.setSeverity} onDateRangeChange={archive.setDateRange} onReplay={archive.onReplay} onReplayTabChange={archive.setReplayTab} onExport={archive.onExport} />;
  return <AutomationView schedulerState={scheduler.schedulerState} jobs={scheduler.jobs} selectedJob={scheduler.selectedJob} notice={scheduler.notice} stats={scheduler.stats} alertEnabled={scheduler.alertEnabled} onSchedulerStateChange={scheduler.setSchedulerState} onSelectJob={scheduler.setSelectedJob} onToggleJob={scheduler.onToggleJob} onRunNow={scheduler.onRunNow} onScheduleNew={scheduler.onScheduleNew} onToggleAlert={scheduler.onToggleAlert} />;
}
