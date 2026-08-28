import { useMemo, useState } from "react";
import { mockAutomationData } from "@/data/mockAutomationData";
import type { ScheduledJob, SchedulerState } from "@/types/operations";

export function useJobScheduler() {
  const [schedulerState, setSchedulerState] = useState<SchedulerState>("ACTIVE");
  const [jobs, setJobs] = useState<ScheduledJob[]>(mockAutomationData);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const stats = useMemo(() => ({ active: jobs.filter((job) => job.isEnabled).length, completed: 27, failed: jobs.filter((job) => job.lastOutcome === "FAILED").length, upcoming: jobs.filter((job) => job.isEnabled).length }), [jobs]);
  return { schedulerState, jobs, selectedJob, alertEnabled, notice, stats, setSchedulerState, setSelectedJob, onToggleAlert: () => setAlertEnabled((value) => !value), onToggleJob: (id: string) => setJobs((current) => current.map((job) => job.id === id ? { ...job, isEnabled: !job.isEnabled } : job)), onRunNow: (job: ScheduledJob) => setNotice(`Run-now request queued for ${job.name}.`), onScheduleNew: () => setNotice("New automation draft is ready for a scheduler adapter.") };
}
