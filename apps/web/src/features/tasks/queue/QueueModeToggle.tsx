export function QueueModeToggle({
  mode,
  onChange
}: {
  mode: "review" | "work";
  onChange: (mode: "review" | "work") => void;
}) {
  return (
    <div className="segmented-control compact-segmented">
      <button className={mode === "work" ? "active" : ""} onClick={() => onChange("work")} type="button">
        Work
      </button>
      <button className={mode === "review" ? "active" : ""} onClick={() => onChange("review")} type="button">
        Review
      </button>
    </div>
  );
}
