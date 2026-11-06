import { Component, type ReactNode } from "react";

// Keeps a crash in one page from blanking the whole app. The sidebar stays usable
// and the error is shown so it can be reported.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty">
          <h2 className="empty__title">This page hit an error</h2>
          <p className="muted">Reload to try again. If it keeps happening, send Claude the message below.</p>
          <pre className="notice notice--error small" style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>
            {this.state.error.message}
          </pre>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
