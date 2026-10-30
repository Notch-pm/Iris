# Assistants IA et plafond d'utilisation

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Ce qui sort d'Iris vers un fournisseur IA** (assistant, 2026-08-29) : le contexte métier
  d'une demande **SANS l'identité de l'usager** — la première défense est le `select`
  (`REQUEST_CONTEXT_COLUMNS` ne demande ni `requester_snapshot`, ni `socle_contact_id`, ni
  `identity_status`), la seconde le retrait des clés du catalogue `DECLARED_KEYS` dans
  `form_data`. La promesse est BORNÉE et écrite partout, jusque dans l'UI : *aucun champ
  d'identité connu ne sort ; un nom en texte libre peut passer*. Le **lieu d'intervention
  reste** (un lieu n'est pas une personne). Le prompt système, le contexte et la base de
  connaissances sont composés **côté serveur** — jamais acceptés du navigateur, dont
  l'historique de conversation est une entrée non fiable. Détail :
  [`docs/assistant-ia.md`](../assistant-ia.md).
- **Plafond d'utilisation IA — DANS LE SOCLE, plus dans Iris** (2026-08-29) : la clé du
  fournisseur LLM et la comptabilité des jetons ont été centralisées dans le référentiel
  (`ai-api`). Le plafond est celui de la **collectivité**, **commun à toute la gamme** — Iris et
  Clara puisent au même seau —, défini par l'admin plateforme dans le Socle et **consulté en
  lecture seule** par l'administrateur du tenant (Paramètres › Assistant IA). **Depuis le
  contrat `ai-api` 1.3.0 (2026-09-22), le Socle peut RÉSERVER une part de ce plafond à une
  application** (l'assistant du portail, `nora`) : les applications sans part — Iris — se
  partagent le reste et y sont bornées. Conséquences : Iris peut être refusé (`429
  ai_quota_exceeded`, même message daté) **avant** que le plafond commun soit atteint — le
  message du Socle est la seule information à relayer, jamais « le plafond de la collectivité
  est atteint » ; et les chiffres rendus (`quota` d'un appel, `quota` du 429, `/v1/usage`)
  sont ceux d'**Iris** — `limit` = le commun moins les parts des autres, `remaining_tokens =
  limit − used − reserved` —, seul `by_consumer` couvrant toute la collectivité (ne jamais
  l'additionner contre `limit`). Sans part réservée, rien ne change. Les trois tables
  `ai_usage_*` d'Iris ont été **supprimées** (`20260829120000`) : les laisser n'aurait pas
  laissé du code mort mais un **second compteur**, qui aurait affiché zéro à qui l'aurait lu.
  ⚠️ La lecture passe par **`socle-proxy /v1/ai/usage`**, donc en service role : le RLS ne garde
  plus rien et la garde administrateur est **réécrite dans la fonction**
  (`is_org_admin_anywhere_for`). Détail : [`docs/assistant-ia.md`](../assistant-ia.md), et
  côté Socle `CLAUDE.md` § « guichet IA ».
- **Assistant IA d'instruction** (`src/features/requests/assistant`, edge `request-assistant`,
  modules purs `supabase/functions/_shared/ai/`) : conversation avec un assistant Mistral, dans
  le sous-onglet « Assistant » du panneau Procédure — à l'instruction (contexte de la demande)
  comme au guichet (**démarche seule**, aucune saisie en cours). Depuis le 2026-09-18, sa base
  de connaissances comprend aussi **ce que la collectivité publie pour ses usagers** (Socle
  1.24.0 : durée d'instruction annoncée, public, pièces annoncées, FAQ usager, descriptif —
  `_shared/ai/userCommunication.ts`), étiqueté pour que les six pièges du contrat tiennent
  jusque dans le prompt : une pièce ANNONCÉE n'est pas une pièce à déposer, la FAQ usager
  n'est pas celle du service. Depuis le 2026-09-19, les **recommandations générales** de la
  collectivité à ses agents (Socle 1.27.0), lues en parallèle, en bloc distinct à plafond
  propre — et la règle « la consigne de la démarche l'emporte » posée HORS du bloc de
  données, parce que c'est une consigne. **Conversation ÉPHÉMÈRE** :
  aucune table, le fil disparaît au rechargement. Droit exigé : **instruction** sur le couple,
  ou un droit de création au guichet.
  **Répondre d'abord, proposer ensuite** (décision PO 2026-09-19) : quand la base ne suffit
  pas, l'assistant peut PROPOSER de consulter les sources que la collectivité a déclarées
  **pour l'IA** — sources en ligne et documents d'entraînement de la démarche, sources
  recommandées pour toutes ses démarches — et **l'agent approuve à chaque fois** sur une carte
  du fil (`_shared/ai/sources/`). Ce n'est **pas un outil** : le modèle écrit une ligne
  `[[CONSULTER: …]]` qu'Iris retire, l'agent décide, Iris lit dans un catalogue FERMÉ qu'il
  relit lui-même dans le Socle (identifiant inconnu ⇒ 400), et `ai-api` reste sans `tools`.
  Le texte lu ne passe **jamais** par l'historique du navigateur : il est relu à chaque tour
  tant que l'accord tient. Une page n'est lue qu'en `https` publique (garde SSRF revérifiée
  à chaque redirection) ; le chemin et l'URL signée d'un document ne quittent pas le serveur.
  ⚠️ **Iris n'appelle pas Mistral** : il compose le prompt — ce qu'il est seul à savoir faire,
  le Socle ignorant ce qu'est une demande — et le confie au guichet `ai-api`, qui réserve,
  appelle et solde. **Iris décide ce qui est dit, le Socle décide si ça peut l'être et ce que ça
  a coûté.** Aucun secret du fournisseur ne vit ici ; la clé Socle d'Iris porte le scope `ai` et
  l'imputation `consumer = iris`. Les refus du guichet sont retraduits par
  `_shared/ai/socleErrors.ts` (pur, testé) : une erreur d'authentification n'est **jamais**
  relayée, un 400 est **notre** bug, et le 429 relaie le message du Socle **mot pour mot** —
  seul lui connaît la date de renouvellement.
  ⚠️ **Chaîne de délais à ne pas inverser : Mistral 55 s < Socle 60 s < Iris 75 s.** Inversée,
  Iris abandonne des appels que le Socle termine et **facture**.
  ⚠️ Un Socle injoignable **éteint** l'assistant (il le dégradait avant) — assumé, et le message
  rappelle que l'instruction des demandes continue →
  [`docs/assistant-ia.md`](../assistant-ia.md).
- **Rédaction assistée des échanges** (2026-09-24, edge `request-email-assistant`) : dans le
  composeur de l'onglet Échanges, un **brouillon** d'accusé de réception ou de suivi
  (ergonomie de Clara, sans clôture) et **« Améliorer mon message »** (la langue, jamais le
  sens). Le brouillon connaît le dossier, la démarche et les **interventions** — **jamais les
  notes internes**. Le texte à améliorer est **pseudonymisé de façon réversible** (`⟦P1⟧`) :
  un jeton perdu ⇒ refus, jamais un texte amputé. Droit d'instruction ; rien n'est stocké →
  [`docs/assistant-ia.md`](../assistant-ia.md) § 9.
- **Assistant de rapprochement des demandes liées** (2026-10-16, edge
  `request-similarity-assistant`) : sur geste de l'agent, un avis « même incident / autre /
  incertain » sur les propositions de la carte « Même incident » — il annote, **il ne lie
  jamais** ; candidates relues sous RLS, identité masquée, clés opaques →
  [`docs/assistant-ia.md`](../assistant-ia.md) § 10.
