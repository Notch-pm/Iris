// Consommation IA d'un tenant — la PRÉSENTATION, et rien d'autre. Module PUR
// (ni DOM, ni réseau), testé : ce que l'écran dessine à partir de ce que le
// Socle a répondu.
//
// ⚠️ SÉPARÉ DE `useAiUsage.ts` À DESSEIN, et à ne pas y replier. Le hook importe
// `@/lib/edge`, donc `@/lib/supabase`, qui LÈVE au chargement du module quand
// `VITE_SUPABASE_URL` manque (garde volontaire de `supabaseConfig.ts`). Un test
// qui importait le hook pour éprouver cette logique pure faisait donc tomber
// tout son fichier partout où il n'y a pas de `.env.local` — c'est-à-dire en
// intégration continue, rouge du 2026-08-29 au 2026-08-31 sans que rien d'autre
// ne soit cassé. La règle de la maison — « logique métier en modules purs
// testés » — n'est pas un goût de rangement : c'est ce qui garde les tests
// indépendants de la configuration.

import { quotaView, type QuotaView } from "@fn/_shared/ai/quota";
import type { AiUsageView } from "@fn/socle-proxy/_shared/sanitize";

/** Ce qu'une application de la gamme a dépensé, et sur quelle fonctionnalité. */
export interface ConsumerUsage {
  consumer: string;
  feature: string | null;
  calls: number;
  tokens: number;
}

export interface AiUsageSummary {
  period: string;
  /** Date ISO rendue par le Socle — Iris ne fait que la mettre en français. */
  renewsAt: string | null;
  /**
   * La jauge d'IRIS (ai-api 1.3.0, 2026-09-22) : `limit` est notre plafond —
   * le plafond commun moins les parts que le Socle réserve à d'autres
   * applications —, `used`/`reserved` ce que nous y avons engagé, et
   * `remaining = limit − used − reserved` exactement ce que la prochaine
   * réservation laissera passer. Sans part réservée, ce sont les chiffres du
   * plafond commun, comme avant.
   */
  view: QuotaView;
  /**
   * Le journal de TOUTE la collectivité, parts comprises — il sait qui a
   * dépensé. ⚠️ Sa somme n'a rien à voir avec `view.limit` : ne jamais les
   * comparer.
   */
  byConsumer: ConsumerUsage[];
}

/** Traduit la réponse du proxy en ce que l'écran dessine. */
export function toSummary(usage: AiUsageView): AiUsageSummary {
  return {
    period: usage.period,
    renewsAt: usage.renews_at,
    view: quotaView({
      limit: usage.limit,
      used: usage.used_tokens,
      reserved: usage.reserved_tokens,
    }),
    // Les plus gros postes d'abord : c'est la question que se pose un
    // administrateur qui ouvre cet écran.
    byConsumer: [...usage.by_consumer].sort((a, b) => b.tokens - a.tokens),
  };
}
