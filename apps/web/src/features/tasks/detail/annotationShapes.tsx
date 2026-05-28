import {
  getBoxHandlePoints,
  getLabelColor,
  pointsToSvg,
  type AnnotationShape,
  type LabelOption
} from "../annotation/geometry";

export type RegionEditKind = "move" | "resize-box" | "move-point";

type AnnotationSvgShapeProps = {
  activeEditKind: RegionEditKind | null;
  isSelected: boolean;
  labelOptions: LabelOption[];
  mode?: "annotation" | "preview";
  shape: AnnotationShape;
};

export function AnnotationSvgShape({
  activeEditKind,
  isSelected,
  labelOptions,
  mode = "annotation",
  shape
}: AnnotationSvgShapeProps) {
  const color = getLabelColor(shape.label, labelOptions);
  const className = [
    "annotation-shape",
    mode === "preview" ? "prediction-preview" : "",
    isSelected ? "selected" : "",
    activeEditKind ? `editing ${activeEditKind}` : ""
  ].filter(Boolean).join(" ");

  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    return (
      <g className={className}>
        <polygon points={pointsToSvg(shape.points)} style={{ stroke: color }} />
      </g>
    );
  }

  return (
    <g className={className}>
      <rect
        height={shape.height ?? 0}
        width={shape.width ?? 0}
        x={shape.x ?? 0}
        y={shape.y ?? 0}
        style={{ stroke: color }}
      />
    </g>
  );
}

export function AnnotationEditHandles({ color, shape }: { color: string; shape: AnnotationShape }) {
  if (shape.type === "POLYGON" && shape.points) {
    return (
      <g className="annotation-edit-handles polygon-handles">
        {shape.points.map((point, index) => (
          <circle
            cx={point.x}
            cy={point.y}
            key={`${shape.id}-${index}`}
            r="0.008"
            style={{ fill: color }}
          />
        ))}
      </g>
    );
  }

  return (
    <g className="annotation-edit-handles box-handles">
      {getBoxHandlePoints(shape).map((handle) => (
        <rect
          height="0.018"
          key={handle.handle}
          style={{ fill: color }}
          width="0.018"
          x={handle.point.x - 0.009}
          y={handle.point.y - 0.009}
        />
      ))}
    </g>
  );
}
