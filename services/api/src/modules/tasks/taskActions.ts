import { TaskStatus, type Task } from "@goxai/database";

export type TaskAction = "assign-self" | "start" | "submit";

export function getTaskActionUpdate(task: Pick<Task, "assignedToId" | "status">, action: TaskAction, userId: string):
  | {
      ok: true;
      data: {
        assignedToId?: string;
        status: TaskStatus;
      };
    }
  | { ok: false; error: string } {
  if (["APPROVED", "ARCHIVED"].includes(task.status)) {
    return { ok: false, error: "This task is already closed." };
  }

  if (action === "assign-self") {
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ASSIGNED) {
      return { ok: false, error: "Only pending or assigned tasks can be assigned." };
    }

    return {
      ok: true,
      data: {
        assignedToId: userId,
        status: TaskStatus.ASSIGNED
      }
    };
  }

  if (action === "start") {
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ASSIGNED && task.status !== TaskStatus.REJECTED) {
      return { ok: false, error: "Only pending, assigned, or rejected tasks can be started." };
    }

    return {
      ok: true,
      data: {
        assignedToId: task.assignedToId ?? userId,
        status: TaskStatus.IN_PROGRESS
      }
    };
  }

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return { ok: false, error: "Only in-progress tasks can be submitted." };
  }

  return {
    ok: true,
    data: {
      assignedToId: task.assignedToId ?? userId,
      status: TaskStatus.SUBMITTED
    }
  };
}
