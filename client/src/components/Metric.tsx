export default function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={`value${tone === 'pos' ? ' positive' : tone === 'neg' ? ' negative' : ''}`}>{value}</div>
    </div>
  );
}
