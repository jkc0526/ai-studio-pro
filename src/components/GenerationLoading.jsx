export default function GenerationLoading({ media }) {
  return (
    <span className="oii-ph loading oii-loading-overlay" role="status" aria-live="polite" aria-atomic="true">
      <span className="oii-spinner" aria-hidden="true" />
      <strong>正在生成{media}</strong>
      <small>模型处理中，请稍候</small>
      <span className="oii-loading-progress" aria-hidden="true"><span /></span>
    </span>
  );
}
