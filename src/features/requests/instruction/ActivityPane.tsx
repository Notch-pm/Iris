// Onglet « Activité » : journal immuable (request_events) fusionné aux notes,
// du plus récent au plus ancien. L'export du journal est à venir (grisé).

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SOON, Surface, SurfaceHead } from "./bits";
import { formatTimeline, type ActivityItem } from "./instruction";

interface Props {
  items: ActivityItem[];
}

export function ActivityPane({ items }: Props) {
  return (
    <Surface>
      <SurfaceHead
        title="Suivi des activités"
        sub="Journal immuable — consultable, jamais modifiable"
        action={<Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" {...SOON}>Exporter le journal</Button>}
      />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune activité enregistrée.</p>
      ) : (
        <ol className="flex flex-col">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-start gap-3">
              <span className="flex shrink-0 flex-col items-center self-stretch" aria-hidden="true">
                <span className={cn("mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full", i === 0 ? "bg-primary" : "bg-border")} />
                {i < items.length - 1 ? <span className="my-[3px] w-0.5 flex-1 bg-border" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pb-4">
                <span className="text-[13px] font-bold">{item.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{item.detail}</span>
                <span className="text-[11px] text-muted-foreground/80">{formatTimeline(item.at)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Surface>
  );
}
