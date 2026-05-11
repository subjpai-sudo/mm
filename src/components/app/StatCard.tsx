import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label, value, hint, icon: Icon, tone = "primary",
}: {
  label: string; value: string | number; hint?: string; icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const toneCls: Record<string, string> = {
    primary: "from-primary/30 to-primary/0 text-primary",
    success: "from-success/30 to-success/0 text-success",
    warning: "from-warning/30 to-warning/0 text-warning",
    destructive: "from-destructive/30 to-destructive/0 text-destructive",
  };
  return (
    <Card className="card-elevated relative overflow-hidden p-5">
      <div className={cn("absolute -top-12 -right-12 size-32 rounded-full bg-gradient-to-br blur-2xl opacity-60", toneCls[tone])} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("size-10 rounded-xl grid place-items-center bg-secondary/60 border border-border", toneCls[tone].split(" ").pop())}>
          <Icon className="size-5" />
        </div>
      </div>
    </Card>
  );
}
