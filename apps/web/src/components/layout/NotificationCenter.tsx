import { Bell, CheckCheck, Inbox, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationSummary
} from "../../api";
import { useAuth } from "../../auth";
import { formatEnum } from "../../utils/format";

export function NotificationCenter() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastUpdatedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    void loadNotifications(session, { quiet: true });
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void loadNotifications(session, { quiet: true });
      }
    }, 60000);

    return () => window.clearInterval(interval);
  }, [session, unreadOnly]);

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("pointerdown", onDocumentPointerDown);
    }

    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [open]);

  async function loadNotifications(activeSession = session, options: { quiet?: boolean; unreadOnly?: boolean } = {}) {
    if (!activeSession) {
      return;
    }

    if (!options.quiet) {
      setLoading(true);
    }

    setError(null);

    try {
      const result = await listNotifications(activeSession, { pageSize: 20, unreadOnly: options.unreadOnly ?? unreadOnly });
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
      lastUpdatedRef.current = new Date().toISOString();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load notifications.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  async function handleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen && session) {
      await loadNotifications(session);
    }
  }

  async function handleMarkAllRead() {
    if (!session || unreadCount === 0) {
      return;
    }

    await markAllNotificationsRead(session);
    setNotifications((items) => unreadOnly ? [] : items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function handleUnreadOnlyChange(nextUnreadOnly: boolean) {
    setUnreadOnly(nextUnreadOnly);

    if (session) {
      await loadNotifications(session, { unreadOnly: nextUnreadOnly });
    }
  }

  async function handleNotificationClick(notification: NotificationSummary) {
    if (!session || notification.readAt) {
      setOpen(false);
      return;
    }

    await markNotificationRead(session, notification.id);
    setNotifications((items) =>
      items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    setOpen(false);
  }

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        aria-label="Notifications"
        className="notification-trigger"
        type="button"
        onClick={() => void handleOpen()}
      >
        <Bell size={17} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-menu" aria-label="Notifications">
          <header className="notification-menu-header">
            <div>
              <strong>Notifications</strong>
              <small>{unreadCount} unread{lastUpdatedRef.current ? ` - updated ${formatNotificationTime(lastUpdatedRef.current)}` : ""}</small>
            </div>
            <div className="notification-header-actions">
              <button className="link-button" disabled={loading} type="button" onClick={() => void loadNotifications(session)}>
                <RefreshCw size={15} />
                Refresh
              </button>
              <button className="link-button" disabled={unreadCount === 0} type="button" onClick={() => void handleMarkAllRead()}>
                <CheckCheck size={15} />
                Mark read
              </button>
            </div>
          </header>
          <div className="notification-controls">
            <div className="segmented-control compact-segmented">
              <button className={!unreadOnly ? "active" : ""} onClick={() => void handleUnreadOnlyChange(false)} type="button">
                All
              </button>
              <button className={unreadOnly ? "active" : ""} onClick={() => void handleUnreadOnlyChange(true)} type="button">
                Unread
              </button>
            </div>
            <div className="notification-quick-links">
              <Link to="/tasks" onClick={() => setOpen(false)}>
                <Inbox size={14} />
                Work
              </Link>
              <Link to="/tasks?queue=review" onClick={() => setOpen(false)}>
                <Inbox size={14} />
                Reviews
              </Link>
            </div>
          </div>
          {error && <p className="form-error compact">{error}</p>}
          {loading && <p className="empty-state">Loading updates...</p>}
          {!loading && notifications.length === 0 && <p className="empty-state">No notifications yet.</p>}
          {!loading && notifications.length > 0 && (
            <div className="notification-list">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onSelect={() => void handleNotificationClick(notification)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onSelect
}: {
  notification: NotificationSummary;
  onSelect: () => void;
}) {
  const content = (
    <>
      <span className={`notification-dot ${notification.readAt ? "" : "unread"}`} />
      <span>
        <strong>{notification.title}</strong>
        {notification.message && <small>{notification.message}</small>}
        <em>{formatEnum(notification.type)} - {formatNotificationTime(notification.createdAt)}</em>
        {notification.actionUrl && <b>{notification.actionLabel}</b>}
      </span>
    </>
  );

  if (notification.actionUrl) {
    return (
      <Link
        className={`notification-item ${notification.readAt ? "" : "unread"}`}
        to={notification.actionUrl}
        onClick={onSelect}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      className={`notification-item ${notification.readAt ? "" : "unread"}`}
      type="button"
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

function formatNotificationTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
