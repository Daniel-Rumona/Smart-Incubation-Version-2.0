import type { ReactNode } from 'react'
import '@/styles/admin-dashboard.css'
import '@/styles/admin-modal.css'

/** The heading of a rounded section inside an admin form modal: icon disc, title, one-line hint, optional extra on the right. */
export function AdminFormSectionHead({ icon, title, hint, extra }: { icon: ReactNode; title: string; hint?: string; extra?: ReactNode }) {
  return (
    <div className="admin-form-modal-section-head">
      <span className="admin-form-modal-section-icon">{icon}</span>
      <div>
        <h4>{title}</h4>
        {hint && <span>{hint}</span>}
      </div>
      {extra}
    </div>
  )
}
