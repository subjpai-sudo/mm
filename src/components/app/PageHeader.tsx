import { ReactNode } from "react";

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: string; subtitle?: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        {eyebrow && <div className="upper-label">{eyebrow}</div>}
        <h1 className="text-[32px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] mt-1">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1.5 text-[14px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
