import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export function LiveBadge({ lastUpdated, className }: { lastUpdated: Date; className?: string }) {
  const [, tick] = useState(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(t);
  }, [lastUpdated]);

  return (
    <div className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span className="relative inline-flex size-2">
        <span className={cn("absolute inline-flex h-full w-full rounded-full bg-success/60", pulse && "animate-ping")} />
        <span className="relative inline-flex rounded-full size-2 bg-success" />
      </span>
      <Radio className="size-3" />
      <span>Live · updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}</span>
    </div>
  );
}