import { CircleAlert, Check, X } from 'lucide-react';
export function Heading({
  eyebrow,
  title,
  description,
  action,
  accent = 'blue'
}) {
  return <header className={`workspace-heading workspace-heading-${accent}`}><div><span className="workspace-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="workspace-heading-actions">{action}</div>}</header>;
}
export function Message({
  error,
  notice,
  clear
}) {
  return <>{error && <div className="workspace-message is-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}{notice && <div className="workspace-message is-success" role="status"><Check size={17} /><span>{notice}</span><button onClick={clear} aria-label="Fechar"><X size={15} /></button></div>}</>;
}
export function Metric({
  icon: Icon,
  label,
  value,
  note,
  tone = 'blue'
}) {
  return <article className={`workspace-metric tone-${tone}`}><span><Icon size={17} /></span><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</article>;
}
export function SmallButton({
  children,
  onClick,
  kind = 'secondary',
  disabled = false
}) {
  return <button type="button" className={`workspace-button ${kind}`} disabled={disabled} onClick={onClick}>{children}</button>;
}
