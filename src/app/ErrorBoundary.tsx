import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Renderfehler im Inhaltsbereich ab. Die Navigation liegt ausserhalb und bleibt nutzbar.
 * App.tsx setzt die Grenze über key beim Reiterwechsel zurück.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Fehler in der Ansicht", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="notice notice-error" role="alert">
        <strong>Diese Ansicht konnte nicht angezeigt werden.</strong>
        <p>Ein unerwarteter Fehler ist aufgetreten. Die anderen Reiter funktionieren weiterhin, bei Bedarf die App neu laden.</p>
        {error.message && <p className="error-detail">{error.message}</p>}
        <div className="button-row notice-actions">
          <button type="button" className="btn" onClick={() => location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
