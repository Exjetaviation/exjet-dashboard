import { Component } from 'react';

// Catches render/effect errors in a subtree so one broken page doesn't blank the
// whole app. Shows the error message instead of a black screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 20, margin: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)', margin: '0 0 8px' }}>
            {this.props.label ? `${this.props.label} hit an error` : 'Something went wrong'}
          </p>
          <pre style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: '6px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
