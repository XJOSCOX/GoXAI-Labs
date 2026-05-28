export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function getNextTaskAction(status: string): { label: string } | null {
  if (status === "REJECTED") {
    return { label: "Revise task" };
  }

  if (status === "PENDING" || status === "ASSIGNED") {
    return { label: "Start task" };
  }

  return null;
}
