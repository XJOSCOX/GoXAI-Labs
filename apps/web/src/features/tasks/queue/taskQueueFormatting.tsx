import type { TaskProjectFolderSummary, TaskSummary } from "../../../api";
import { formatEnum } from "../../../utils/format";
import { formatTaskFolderEarnings } from "../payment/payment";

export function formatTaskCount(count: number) {
  return `${count} task${count === 1 ? "" : "s"}`;
}

export function formatPendingUnassigned(pending: number, unassigned: number) {
  return `${pending}/${unassigned}`;
}

export function getTaskFolderProgress(done: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((done / total) * 100));
}

export function TaskFolderEarningsBadge({
  earnings,
  mode
}: {
  earnings: TaskProjectFolderSummary["earnings"];
  mode: "review" | "work";
}) {
  return (
    <span className="task-folder-earnings" title="Excludes approved tasks">
      <small>{mode === "review" ? "Review pay" : "Task pay"}</small>
      <strong>{formatTaskFolderEarnings(earnings)}</strong>
    </span>
  );
}

export function getTaskQualityBadges(flags: string[], showAIBadges: boolean) {
  const aiFlags = showAIBadges ? flags.filter((flag) => flag.startsWith("AI_")) : [];
  const otherFlags = flags.filter((flag) => !flag.startsWith("AI_"));

  return [...aiFlags, ...otherFlags].slice(0, 4).map((flag) => ({
    ai: flag.startsWith("AI_"),
    flag,
    label: getTaskQualityBadgeLabel(flag)
  }));
}

export function getTaskQualityBadgeLabel(flag: string) {
  if (flag === "AI_ASSISTED") {
    return "AI assisted";
  }

  if (flag === "AI_EDITED") {
    return "AI edited";
  }

  if (flag === "AI_LOW_CONFIDENCE") {
    return "Low AI confidence";
  }

  if (flag === "AI_REMOVED") {
    return "AI removed";
  }

  return formatEnum(flag);
}

export function formatTaskDueDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short"
  }).format(new Date(value));
}

export function isPastDue(value: string) {
  return new Date(value).getTime() < Date.now();
}

export function getNextTaskAction(task: TaskSummary): { kind: "assign" | "start"; label: string } | null {
  if (task.status === "REJECTED") {
    return { kind: "start", label: "Revise" };
  }

  if (task.status === "PENDING" || task.status === "ASSIGNED") {
    return { kind: "start", label: "Start" };
  }

  return null;
}
