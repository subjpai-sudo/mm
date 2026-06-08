import type React from "react";
import { ExternalLink, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { BILLING_APP_URL } from "@/lib/billing-server";

type Props = {
  className?: string;
  label?: string;
  showIcon?: boolean;
  variant?: "button" | "nav";
  onClick?: () => void;
};

function openBilling(url = BILLING_APP_URL) {
  window.location.assign(url);
}

export function BillingServerLink({
  className,
  label = "Billing",
  showIcon = true,
  variant = "button",
  onClick,
}: Props) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onClick?.();
    openBilling();
  };

  if (variant === "nav") {
    return (
      <a
        href={BILLING_APP_URL}
        onClick={handleClick}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] transition-all",
          "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
          className,
        )}
      >
        {showIcon && <Receipt className="size-[15px]" />}
        {label}
        <ExternalLink className="size-3 ml-auto opacity-60" />
      </a>
    );
  }

  return (
    <a
      href={BILLING_APP_URL}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.98]",
        className,
      )}
    >
      {showIcon && <Receipt className="size-5" />}
      {label}
      <ExternalLink className="size-3.5 opacity-70" />
    </a>
  );
}
