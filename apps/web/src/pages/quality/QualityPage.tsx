import { Activity, BadgeCheck, GitCompareArrows, ListChecks, Microscope, Star, TriangleAlert, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getQualityStats, type QualityStatsResult } from "../../api";
import { useAuth } from "../../auth";
import { formatEnum } from "../../utils/format";

type QualityView = "datasets" | "people" | "review" | "trend";
const qualityStatsCache = new Map<string, { fetchedAt: number; quality: QualityStatsResult }>();
const qualityStatsCacheTtlMs = 60_000;

export function QualityPage() {
  const { session } = useAuth();
  const [activeView, setActiveView] = useState<QualityView>("review");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quality, setQuality] = useState<QualityStatsResult | null>(null);
  const sessionRef = useRef(session);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let mounted = true;

    async function loadQualityStats() {
      if (!userId) {
        setQuality(null);
        return;
      }

      const cached = qualityStatsCache.get(userId);
      const cacheIsFresh = cached && Date.now() - cached.fetchedAt < qualityStatsCacheTtlMs;

      if (cached) {
        setQuality(cached.quality);
      }

      if (cacheIsFresh) {
        return;
      }

      setLoading(!cached);
      setError(null);

      try {
        const activeSession = sessionRef.current;

        if (!activeSession) {
          return;
        }

        const result = await getQualityStats(activeSession);

        if (mounted) {
          qualityStatsCache.set(userId, { fetchedAt: Date.now(), quality: result });
          setQuality(result);
        }
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "Unable to load quality analytics.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadQualityStats();

    return () => {
      mounted = false;
    };
  }, [userId]);

  const summary = quality?.summary;

  return (
    <section className="page-stack quality-page">
      {error && <p className="form-error">{error}</p>}
      <section className="panel quality-command-center">
        <div className="quality-command-card quality-score-card">
          <div>
            <Star size={22} />
            <span>Quality score</span>
          </div>
          <strong>{summary?.datasetQualityScore ?? 0}/100</strong>
          <small>Dataset readiness</small>
        </div>
        <div className="quality-command-card">
          <div>
            <ListChecks size={20} />
            <span>Review quality</span>
          </div>
          <div className="quality-metric-grid">
            <QualityMetric icon={<ListChecks size={15} />} label="Reviewed" value={summary?.reviewed ?? 0} />
            <QualityMetric icon={<BadgeCheck size={15} />} label="Approved" value={summary?.approved ?? 0} />
            <QualityMetric icon={<TriangleAlert size={15} />} label="Changes" value={summary?.rejected ?? 0} />
            <QualityMetric icon={<Activity size={15} />} label="Acceptance" value={formatPercent(summary?.acceptanceRate ?? 0)} />
          </div>
        </div>
        <div className="quality-command-card">
          <div>
            <Microscope size={20} />
            <span>Coverage</span>
          </div>
          <div className="quality-metric-grid">
            <QualityMetric icon={<Microscope size={15} />} label="Sampling" value={formatPercent(quality?.sampling.sampleRate ?? 0)} />
            <QualityMetric icon={<GitCompareArrows size={15} />} label="Agreement" value={formatNullablePercent(quality?.consensus.agreementRate ?? null)} />
            <QualityMetric icon={<UsersRound size={15} />} label="Reviewers" value={quality?.reviewers.length ?? 0} />
          </div>
        </div>
      </section>

      <nav className="quality-view-tabs" aria-label="Quality dashboard sections">
        {qualityViews.map((view) => (
          <button className={activeView === view.value ? "active" : ""} key={view.value} onClick={() => setActiveView(view.value)} type="button">
            <view.icon size={16} />
            {view.label}
          </button>
        ))}
      </nav>

      {activeView === "review" ? (
        <div className="quality-grid quality-review-grid">
          <QualitySamplingPanel quality={quality} loading={loading} />
          <div className="quality-review-side">
            <QualityPanel title="Rejection reasons" eyebrow="Review quality" items={quality?.rejectionReasons ?? []} loading={loading} showShare />
            <QualityPanel title="Severity mix" eyebrow="Review quality" items={quality?.severity ?? []} loading={loading} />
            <QualityConsensusPanel quality={quality} loading={loading} />
          </div>
        </div>
      ) : null}

      {activeView === "datasets" ? (
        <div className="quality-grid">
          <QualityDatasetPanel quality={quality} loading={loading} />
        </div>
      ) : null}

      {activeView === "people" ? (
        <div className="quality-grid">
          <QualityPeoplePanel title="Reviewer activity" eyebrow="Reviewers" people={quality?.reviewers ?? []} loading={loading} mode="review" />
          <QualityPeoplePanel title="Annotator performance" eyebrow="Annotators" people={quality?.annotators ?? []} loading={loading} mode="annotator" />
        </div>
      ) : null}

      {activeView === "trend" ? (
        <div className="quality-grid">
          <QualityTrendPanel quality={quality} loading={loading} />
        </div>
      ) : null}
    </section>
  );
}

const qualityViews: { icon: typeof Microscope; label: string; value: QualityView }[] = [
  { icon: Microscope, label: "Review", value: "review" },
  { icon: Star, label: "Datasets", value: "datasets" },
  { icon: UsersRound, label: "People", value: "people" },
  { icon: Activity, label: "Trend", value: "trend" }
];

function QualityMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <span className="quality-mini-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function QualityTrendPanel({ loading, quality }: { loading: boolean; quality: QualityStatsResult | null }) {
  return (
    <section className="panel quality-trend-panel quality-wide-panel">
      <div>
        <p className="eyebrow">Trend</p>
        <h2>Last reviewed days</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading quality trend.</p>
      ) : quality && quality.trend.length > 0 ? (
        <div className="quality-trend-list">
          {quality.trend.map((day) => (
            <article className="quality-trend-row" key={day.date}>
              <span>{day.date}</span>
              <div>
                <span style={{ width: `${Math.max(4, day.total * 14)}px` }} />
              </div>
              <strong>{day.total}</strong>
              <small>
                {day.approved} approved, {day.rejected} changes
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">Review completed tasks to build quality trend data.</p>
      )}
    </section>
  );
}

function QualityPanel({
  eyebrow,
  items,
  loading,
  showShare = false,
  title
}: {
  eyebrow: string;
  items: Array<{ count: number; label: string; share?: number }>;
  loading: boolean;
  showShare?: boolean;
  title: string;
}) {
  return (
    <section className="panel quality-list-panel">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading.</p>
      ) : items.length > 0 ? (
        <div className="quality-list">
          {items.map((item) => (
            <article className="quality-list-row" key={item.label}>
              <span>{formatEnum(item.label)}</span>
              <strong>{showShare && typeof item.share === "number" ? `${item.count} · ${formatPercent(item.share)}` : item.count}</strong>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No review metadata yet.</p>
      )}
    </section>
  );
}

function QualityPeoplePanel({
  eyebrow,
  loading,
  mode,
  people,
  title
}: {
  eyebrow: string;
  loading: boolean;
  mode: "annotator" | "review";
  people: QualityStatsResult["reviewers"];
  title: string;
}) {
  return (
    <section className="panel quality-list-panel">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading.</p>
      ) : people.length > 0 ? (
        <div className="quality-list">
          {people.map((person) => (
            <article className="quality-person-row" key={person.id}>
              <span>
                <strong>{person.name}</strong>
                <small>
                  {mode === "annotator"
                    ? `${person.submitted} submitted, ${person.reviewed} reviewed`
                    : `${person.approved} approved, ${person.rejected} changes`}
                </small>
              </span>
              <em>{mode === "annotator" ? `${person.qualityScore}/100` : formatPercent(person.acceptanceRate)}</em>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No people metrics yet.</p>
      )}
    </section>
  );
}

function QualitySamplingPanel({ loading, quality }: { loading: boolean; quality: QualityStatsResult | null }) {
  return (
    <section className="panel quality-list-panel quality-sampling-panel">
      <div>
        <p className="eyebrow">Review sampling</p>
        <h2>Sampling coverage</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading.</p>
      ) : quality ? (
        <>
          <div className="quality-metric-strip">
            <Metric label="Sample rate" value={formatPercent(quality.sampling.sampleRate)} />
            <Metric label="Target" value={formatPercent(quality.sampling.targetRate)} />
            <Metric label="Pending review" value={quality.sampling.pendingReview} />
          </div>
          {quality.samplingCandidates.length > 0 ? (
            <div className="quality-list compact">
              {quality.samplingCandidates.map((candidate) => (
                <article className="quality-list-row" key={candidate.taskId}>
                  <span>
                    <Link to={`/tasks/${candidate.taskId}`}>{candidate.assetName}</Link>
                    <small>{candidate.datasetName} · P{candidate.priority}</small>
                  </span>
                  <strong>{formatEnum(candidate.status)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No unsampled submitted tasks right now.</p>
          )}
        </>
      ) : (
        <p className="muted-copy">No sampling data yet.</p>
      )}
    </section>
  );
}

function QualityConsensusPanel({ loading, quality }: { loading: boolean; quality: QualityStatsResult | null }) {
  return (
    <section className="panel quality-list-panel quality-consensus-panel">
      <div>
        <p className="eyebrow">Consensus</p>
        <h2>Annotator agreement</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading.</p>
      ) : quality ? (
        <>
          <div className="quality-metric-strip">
            <Metric label="Exact" value={formatNullablePercent(quality.consensus.agreementRate)} />
            <Metric label="Labels" value={formatNullablePercent(quality.consensus.labelAgreementRate)} />
            <Metric label="Overlap tasks" value={quality.consensus.overlapTasks} />
          </div>
          {quality.disagreements.length > 0 ? (
            <div className="quality-list compact">
              {quality.disagreements.map((item) => (
                <article className="quality-list-row" key={item.taskId}>
                  <span>
                    <Link to={`/tasks/${item.taskId}`}>{item.assetName}</Link>
                    <small>{item.datasetName} · {item.annotators.join(", ")}</small>
                  </span>
                  <strong>{formatPercent(item.labelAgreementRate)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No disagreement hotspots yet.</p>
          )}
        </>
      ) : (
        <p className="muted-copy">No consensus data yet.</p>
      )}
    </section>
  );
}

function QualityDatasetPanel({ loading, quality }: { loading: boolean; quality: QualityStatsResult | null }) {
  return (
    <section className="panel quality-list-panel quality-wide-panel">
      <div>
        <p className="eyebrow">Dataset quality</p>
        <h2>Quality score by dataset</h2>
      </div>
      {loading ? (
        <p className="muted-copy">Loading.</p>
      ) : quality && quality.datasets.length > 0 ? (
        <div className="quality-list">
          {quality.datasets.map((dataset) => (
            <article className="quality-dataset-row" key={dataset.id ?? dataset.name}>
              <span>
                <strong>{dataset.name}</strong>
                <small>
                  {dataset.reviewed} reviewed · {formatNullablePercent(dataset.samplingRate)} sampled · {formatNullablePercent(dataset.agreementRate)} agreement
                </small>
              </span>
              <em>{dataset.qualityScore}/100</em>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No dataset score yet.</p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatNullablePercent(value: number | null) {
  return value === null ? "N/A" : formatPercent(value);
}
