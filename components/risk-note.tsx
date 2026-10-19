import { describeRisk, type RiskReason } from "@/lib/risk";
import { Badge } from "@/components/ui/badge";

// The "At risk" marker and the reasons behind it. Renders nothing for a healthy project.
export function RiskNote({ reasons }: { reasons: RiskReason[] | undefined }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div className="mt-1 grid gap-0.5">
      <Badge variant="destructive" className="w-fit">At risk</Badge>
      {reasons.map((r) => (
        <span key={`${r.kind}-${r.due}`} className="text-xs font-normal text-destructive">
          {describeRisk(r)}
        </span>
      ))}
    </div>
  );
}
