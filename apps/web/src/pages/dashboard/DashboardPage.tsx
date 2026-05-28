import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Database,
  ShieldCheck,
  UserCheck,
  Users,
  WalletCards
} from "lucide-react";
import { Link } from "react-router-dom";
import { getAdminOverview, type AdminOverview } from "../../api";
import { useAuth } from "../../auth";
import {
  useCreatorWalletSummary,
  useDatasets,
  useOrganizations,
  useProjects,
  useTaskStats,
  useWorkerWalletSummary
} from "../../hooks/useResources";
import { formatDate, formatEnum } from "../../utils/format";

const DASHBOARD_PAGE_SIZE = 8;

interface ChartSegment {
  color: string;
  label: string;
  value: number;
}

export function DashboardPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const { projects } = useProjects(session);
  const { datasets } = useDatasets(session);
  const { stats: taskStats } = useTaskStats(session);
  const { wallet: creatorWallet } = useCreatorWalletSummary(session);
  const { wallet: workerWallet } = useWorkerWalletSummary(session);
  const [projectPage, setProjectPage] = useState(1);
  const [datasetPage, setDatasetPage] = useState(1);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const readyDatasets = datasets.filter((dataset) => dataset.status === "READY").length;
  const configuredDatasets = datasets.filter((dataset) => hasDatasetConfiguration(dataset)).length;
  const datasetNeedsTemplate = datasets.filter((dataset) => !hasDatasetConfiguration(dataset)).length;
  const sortedProjects = useMemo(
    () => [...projects].sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()),
    [projects]
  );
  const sortedDatasets = useMemo(
    () => [...datasets].sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()),
    [datasets]
  );
  const projectPagination = paginate(sortedProjects, projectPage, DASHBOARD_PAGE_SIZE);
  const datasetPagination = paginate(sortedDatasets, datasetPage, DASHBOARD_PAGE_SIZE);
  const readyPercent = getPercent(readyDatasets, datasets.length);
  const maxPayout = Math.max(...workerWallet.payouts.map((payout) => payout.amount), 0);
  const taskSegments: ChartSegment[] = [
    { color: "#fbbf24", label: "Pending", value: taskStats.pending },
    { color: "#38bdf8", label: "Active", value: taskStats.active },
    { color: "#a78bfa", label: "Review", value: taskStats.review },
    { color: "#34d399", label: "Approved", value: taskStats.approved },
    { color: "#fb7185", label: "Rejected", value: taskStats.rejected }
  ];
  const datasetSegments: ChartSegment[] = [
    { color: "#34d399", label: "Ready", value: readyDatasets },
    { color: "#38bdf8", label: "Configured draft", value: Math.max(configuredDatasets - readyDatasets, 0) },
    { color: "#fbbf24", label: "Needs template", value: datasetNeedsTemplate }
  ];
  const peopleStats = adminOverview?.people ?? {
    admins: dbUser?.globalRole === "SUPER_ADMIN" ? 1 : organizations.filter((organization) => organization.role === "OWNER" || organization.role === "ADMIN").length,
    annotators: 0,
    creators: dbUser?.creatorStatus === "APPROVED" ? 1 : 0,
    pendingVerification: dbUser?.verificationStatus === "PENDING" ? 1 : 0,
    reviewers: 0,
    totalUsers: organizations.reduce((total, organization) => total + organization.counts.members, 0)
  };

  useEffect(() => {
    let cancelled = false;

    if (!session || dbUser?.globalRole !== "SUPER_ADMIN") {
      setAdminOverview(null);
      return;
    }

    void getAdminOverview(session)
      .then((overview) => {
        if (!cancelled) {
          setAdminOverview(overview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdminOverview(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dbUser?.globalRole, session]);

  return (
    <section className="page-stack dashboard-page">
      <div className="dashboard-top-grid">
        <section className="panel dashboard-summary-panel compact">
          <div className="dashboard-summary-main">
            <div>
              <p className="eyebrow">Workspace overview</p>
              <h2>Operations readiness</h2>
              <p className="muted-copy">
                {peopleStats.totalUsers > 0
                  ? `${peopleStats.totalUsers} users in this workspace. ${readyDatasets} of ${datasets.length} datasets are ready.`
                  : "Invite users and prepare datasets to start tracking work here."}
              </p>
            </div>
            <div className="dashboard-score-row">
              <strong>{readyPercent}%</strong>
              <span>ready</span>
            </div>
          </div>
          <div className="dashboard-mini-progress" aria-label={`${readyPercent}% of datasets are ready`}>
            <span style={{ width: `${readyPercent}%` }} />
          </div>
          <div className="dashboard-summary-metrics">
            <SummaryMetric icon={<Users size={17} />} label="Users" value={peopleStats.totalUsers} />
            <SummaryMetric icon={<ShieldCheck size={17} />} label="Admins" value={peopleStats.admins} />
            <SummaryMetric icon={<UserCheck size={17} />} label="Creators" value={peopleStats.creators} />
            <SummaryMetric icon={<UserCheck size={17} />} label="Annotators" value={peopleStats.annotators} />
            <SummaryMetric icon={<UserCheck size={17} />} label="Reviewers" value={peopleStats.reviewers} />
            <SummaryMetric icon={<Clock3 size={17} />} label="Pending verify" value={peopleStats.pendingVerification} />
          </div>
        </section>

        <section className="panel dashboard-operations-panel">
          <div className="dashboard-chart-head">
            <div>
              <p className="eyebrow">Workload</p>
              <h2>Tasks and datasets</h2>
            </div>
            <span className="dashboard-operations-note">
              {taskStats.pending} pending - {taskStats.unassigned} unassigned - {datasetNeedsTemplate} need template
            </span>
          </div>
          <div className="dashboard-workload-grid">
            <WorkloadBoard
              heading="Task status"
              primaryLabel="Total tasks"
              primaryValue={taskStats.total}
              segments={taskSegments}
              total={taskStats.total}
            />
            <WorkloadBoard
              heading="Dataset readiness"
              primaryLabel="Ready"
              primaryValue={`${readyPercent}%`}
              segments={datasetSegments}
              total={datasets.length}
            />
          </div>
        </section>

        <section className="panel dashboard-wallet-summary">
          <div className="dashboard-wallet-head">
            <WalletCards size={19} />
            <div>
              <p className="eyebrow">Wallet</p>
              <h2>Money summary</h2>
            </div>
          </div>
          <div className="dashboard-wallet-metrics">
            <WalletMetric label="Creator available" value={formatMoney(creatorWallet.availableBalance, creatorWallet.currency)} />
            <WalletMetric label="Creator escrow" value={formatMoney(creatorWallet.reservedBalance, creatorWallet.currency)} />
            <WalletMetric label="Paid to annotators" value={formatMoney(creatorWallet.paidToAnnotators, creatorWallet.currency)} />
            <WalletMetric label="Worker under review" value={formatMoney(workerWallet.underReviewBalance, workerWallet.currency)} />
            <WalletMetric label="Worker available" value={formatMoney(workerWallet.availableBalance, workerWallet.currency)} />
            <WalletMetric label="Max payout" value={formatMoney(maxPayout, workerWallet.currency)} />
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="panel dashboard-list-panel">
          <DashboardListHead
            actionHref="/projects"
            actionLabel="Open projects"
            eyebrow="Projects"
            page={projectPagination.page}
            title="Recent project activity"
            totalPages={projectPagination.totalPages}
            onNext={() => setProjectPage((page) => Math.min(page + 1, projectPagination.totalPages))}
            onPrevious={() => setProjectPage((page) => Math.max(page - 1, 1))}
          />
          <div className="dashboard-list fixed">
            {projectPagination.items.length > 0 ? projectPagination.items.map((project) => (
              <Link className="dashboard-list-row" key={project.id} to={`/projects/${project.id}`}>
                <span>
                  <strong>{project.name}</strong>
                  <small>{formatEnum(project.dataType)} - {project.counts.datasets} datasets - {project.counts.tasks} tasks</small>
                </span>
                <em>{formatEnum(project.status)}</em>
              </Link>
            )) : (
              <p className="muted-copy">No projects yet.</p>
            )}
          </div>
        </section>

        <section className="panel dashboard-list-panel">
          <DashboardListHead
            actionHref="/datasets"
            actionLabel="Open datasets"
            eyebrow="Datasets"
            page={datasetPagination.page}
            title="Latest datasets"
            totalPages={datasetPagination.totalPages}
            onNext={() => setDatasetPage((page) => Math.min(page + 1, datasetPagination.totalPages))}
            onPrevious={() => setDatasetPage((page) => Math.max(page - 1, 1))}
          />
          <div className="dashboard-list fixed">
            {datasetPagination.items.length > 0 ? datasetPagination.items.map((dataset) => (
              <Link className="dashboard-list-row" key={dataset.id} to={`/datasets/${dataset.id}`}>
                <span>
                  <strong>{dataset.name}</strong>
                  <small>{dataset.project.name} - v{dataset.version} - updated {formatDate(dataset.updatedAt)}</small>
                </span>
                <em>{hasDatasetConfiguration(dataset) ? <CheckCircle2 size={14} /> : null}{formatEnum(dataset.status)}</em>
              </Link>
            )) : (
              <p className="muted-copy">No datasets yet.</p>
            )}
          </div>
        </section>

        <section className="panel dashboard-placeholder-panel">
          <div>
            <p className="eyebrow">Next</p>
            <h2>Operational insight</h2>
          </div>
          <div className="dashboard-placeholder-body">
            <Database size={22} />
            <p>Placeholder for the next dashboard signal.</p>
            <small>We can turn this into reviews, quality, storage, or earnings trends next.</small>
          </div>
        </section>
      </div>
    </section>
  );
}

function DashboardListHead({
  actionHref,
  actionLabel,
  eyebrow,
  onNext,
  onPrevious,
  page,
  title,
  totalPages
}: {
  actionHref: string;
  actionLabel: string;
  eyebrow: string;
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  title: string;
  totalPages: number;
}) {
  return (
    <div className="compact-panel-head dashboard-list-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <div className="dashboard-list-actions">
        <Link className="secondary-button compact-button" to={actionHref}>
          {actionLabel}
        </Link>
        <div className="dashboard-mini-pagination">
          <button disabled={page <= 1} type="button" onClick={onPrevious}>
            Previous
          </button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} type="button" onClick={onNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({ helper, icon, label, value }: { helper?: string; icon: ReactNode; label: string; value: number }) {
  return (
    <div className="dashboard-summary-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

function WalletMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-wallet-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkloadBoard({
  heading,
  primaryLabel,
  primaryValue,
  segments,
  total
}: {
  heading: string;
  primaryLabel: string;
  primaryValue: ReactNode;
  segments: ChartSegment[];
  total: number;
}) {
  return (
    <div className="dashboard-workload-board">
      <div className="dashboard-workload-head">
        <span>{heading}</span>
        <strong>{primaryValue}</strong>
        <small>{primaryLabel}</small>
      </div>
      <StackedBar segments={segments} total={total} />
      <div className="dashboard-workload-list">
        {segments.map((segment) => (
          <span className="dashboard-workload-row" key={segment.label}>
            <i style={{ background: segment.color }} />
            <em>{segment.label}</em>
            <b>{segment.value}</b>
            <small>{getPercent(segment.value, total)}%</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function StackedBar({ segments, total }: { segments: ChartSegment[]; total: number }) {
  if (total <= 0) {
    return <div className="dashboard-empty-chart compact">No data yet.</div>;
  }

  return (
    <div className="dashboard-stacked-bar" role="img" aria-label="Distribution chart">
      {segments.filter((segment) => segment.value > 0).map((segment) => (
        <span
          className="dashboard-stacked-segment"
          key={segment.label}
          style={{
            background: segment.color,
            width: `${Math.max(getPercent(segment.value, total), 2)}%`
          }}
          title={`${segment.label}: ${segment.value}`}
        />
      ))}
    </div>
  );
}

function paginate<Item>(items: Item[], requestedPage: number, pageSize: number) {
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    totalPages
  };
}

function getPercent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function hasDatasetConfiguration(dataset: { labels: unknown[]; tools: { enabled: boolean }[] }) {
  return dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}
