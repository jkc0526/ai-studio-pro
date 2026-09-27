export default function ErrorSummary({ error, className = 'err-box' }) {
  if (!error) return null;
  const full = String(error);
  const summary = full.replace(/\s+/g, ' ').trim().slice(0, 120);
  return (
    <details className={className}>
      <summary>{summary}{summary.length < full.length ? '…' : ''}</summary>
      <div className="error-detail">{full}</div>
    </details>
  );
}
