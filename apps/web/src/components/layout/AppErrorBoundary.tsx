import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GoXAI app route failed to render.", { error, info });
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return <AppErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

function AppErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const isChunkError = isRouteChunkError(error);

  return (
    <main className="loading-screen app-error-screen">
      <div className="brand-mark">GX</div>
      <h1>{isChunkError ? "Unable to load this screen" : "Something went wrong"}</h1>
      <p>
        {isChunkError
          ? "The app could not download the latest screen bundle. This can happen after an update or a brief network drop."
          : "The current screen hit an unexpected error. You can retry the screen or reload the app."}
      </p>
      <div className="row-actions compact">
        <button className="primary-button compact-button" type="button" onClick={onRetry}>
          Retry
        </button>
        <button className="secondary-button compact-button" type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}

function isRouteChunkError(error: Error) {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    `${error.name} ${error.message}`
  );
}
