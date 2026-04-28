// ErrorBoundary — catches render errors in high-risk subtrees and presents
// a recoverable UI instead of a blank white Tauri window.
// Class component is required by React for getDerivedStateFromError.

import React from "react";

interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  /** Optional custom fallback. Defaults to a styled in-app error card. */
  readonly fallback?: React.ReactNode;
  /** Label shown in the error card to identify which part failed */
  readonly label?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const label = this.props.label ?? "component";

    return (
      <div className="error-boundary">
        <div className="error-boundary-icon">!</div>
        <div className="error-boundary-title">
          {label} crashed
        </div>
        <pre className="error-boundary-msg">{error.message}</pre>
        <button
          type="button"
          className="settings-btn-secondary error-boundary-btn"
          onClick={this.handleReset}
        >
          retry
        </button>
      </div>
    );
  }
}
