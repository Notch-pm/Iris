# E-mails : serveur d'envoi, chemins, charte

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Textes des courriels à l'usager : le Socle** (2026-11-12, décision PO). Accusé de
  réception, avis de statut, nouveau message, avis de clôture et nouveau code d'accès
  partent avec l'objet et le texte que la collectivité règle dans le Socle (courriels
  système, miroir `socle_email_templates`, lecture `loadSystemTemplates`). Iris garde
  l'**habillage** (charte, bouton, ligne du lien, pied, désinscription), le code d'accès
  **masqué** dans l'échange enregistré, et **ses textes d'origine en repli** (miroir vide ou
  illisible). Les textes d'origine du Socle ont été repris d'Iris : rendus avec les mêmes
  données, ils donnent le message d'avant au caractère près (`socleTemplates.test.ts`).
  ⚠️ « Plusieurs nouveaux messages » : le texte d'origine du Socle est au singulier, Iris garde
  le sien tant que la collectivité ne l'a pas réécrit. Détail : [`docs/emails.md`](../emails.md).

- **Aucun mot de passe n'est généré ni affiché à un administrateur** : un compte s'ouvre par
  une **invitation** (lien d'activation à usage unique, mot de passe choisi par son titulaire)
  et se dépanne par un **lien de réinitialisation** envoyé au titulaire. Le **serveur d'envoi
  ne se configure pas dans Iris** (décision PO 2026-08-23) : il est défini dans le **Socle**
  pour l'organisation principale et recopié par la synchro du référentiel — `smtp_settings`
  est un miroir, sans aucune surface d'écriture ni de lecture cliente. Le mot de passe reçu
  vit dans le **Vault Postgres**, jamais dans une colonne lisible : Iris ne réplique pas la
  dette « mots de passe SMTP en clair » de Socle et Clara.
  Détail : [`docs/emails.md`](../emails.md).

- **Emails** : gabarit unique dans `supabase/functions/_shared/email/` (modules purs testés
  + `transport.ts` nodemailer), serveur d'envoi **hérité du Socle** (`smtp_settings` = miroir
  de l'organisation principale, écrit par la seule synchro du référentiel via
  `sync_smtp_settings_from_socle`, mot de passe au Vault) avec repli sur un relais de
  plateforme (`IRIS_SMTP_*`). La clé Socle doit porter le scope `smtp`. Deux chemins :
  `auth-email-hook` (hook « Send Email » de GoTrue — mot de passe oublié self-service, **à
  activer une fois dans le dashboard**) et `admin-users` (invitation, renvoi de lien — liens
  produits par `generateLink`, donc indépendants du hook). Depuis le 2026-08-26, un troisième
  chemin sort du cercle des agents : **`send-request-email`**, la réponse à l'usager depuis
  l'onglet Échanges (envoi SYNCHRONE, droit d'**instruction** revérifié en SQL, destinataire et
  chemins de pièces résolus côté serveur, marque = la collectivité seule). La doctrine « ce qui
  sort d'Iris » de `notifications.ts` vise les e-mails **aux agents** et ne s'y applique pas —
  seul reste absolu : **le corps d'une note interne ne sort jamais**. Depuis le 2026-08-28,
  `send-request-email` a un second mode : l'**avis de clôture** (`kind: "cloture"`), composé
  intégralement par le serveur et exigeant le droit de **clôture** — c'est parce que le
  navigateur ne compose rien que l'ouverture à ce droit est sans risque ; le motif de clôture,
  lui, ne sort jamais — et l'avis **ne part jamais pour une demande issue de Clara**
  (2026-10-16, `closureNoticeApplies` : Iris n'écrit rien à leur auteur, accusé compris).
  Depuis le 2026-10-09, un quatrième chemin, sans agent : l'**accusé de réception au dépôt**
  (guichet et API d'ingestion — **jamais pour une demande issue de Clara**, règle posée dans
  `enqueue_request_receipt` ; aucune désactivation, décision PO). Les deux fonctions de dépôt
  **enfilent** (`request_receipts`) et `notifications-mailer` **draine** — un relais qui tousse
  ne fait jamais échouer un dépôt ; composé par le serveur (`_shared/email/accuse.ts`), tracé
  dans `request_emails` avec `sent_by` NULL (« Iris · envoi automatique »). Pas de trigger sur
  `requests`, pour qu'un jeu de démonstration n'écrive à personne.
  **Code d'accès au GUICHET** (décision PO du 2026-11-13) : une demande saisie dans Iris reçoit
  elle aussi un code d'accès, **toujours**, dès que l'identité porte une adresse — sans case à
  cocher. `create-request-from-procedure` passe par `register_request_access` (même porte que
  le portail : empreintes, accusé enfilé, code confié à la file) au lieu de
  `enqueue_request_receipt`. Page de suivi citée = `<origine du portail>/suivi`
  (`guichetTrackingUrl`, origine de `integration_sources.citizen_space_url`) ; **sans portail
  déclaré, pas de code** — il n'ouvrirait rien. Le portail ouvre ces demandes parce que
  `check_request_access`, `request_access_resend` (migration `20261113100000`) et
  `citizenAccessible` acceptent la source `iris` en plus de la sienne, tenant toujours imposé.
  Constat d'origine : DEM-2026-000066 (SNA27), accusé sans code.
  Depuis le 2026-08-30, ces deux messages à l'usager portent la **charte graphique de la
  collectivité** — couleur principale des bordures et du bouton, logo — lue chez le Socle
  (`GET /v1/organizations/{id}/branding`, scope `read`) pour l'organisation **porteuse de la
  demande** (`socle_scope_org_id`) : la route RÉSOUT l'héritage, donc « à défaut, celle de
  l'organisation parente » est déjà répondu et Iris ne remonte aucun arbre. ⚠️ **Jamais depuis
  `/v1/organizations/{id}`** : les colonnes brutes d'une organisation qui hérite sont nulles.
  Depuis le 2026-09-23 le **bandeau est blanc** (logo centré, depuis le 2026-09-24 ; colonne
  arrondie aux quatre coins, en VML pour Outlook — même cadre que Clara et le Socle) : la couleur ne trace plus que les bordures de
  la carte, le filet sous le bandeau et le fond du bouton — un aplat de couleur entrait en
  collision avec le logo. Seul le logo **couleur** est servi (le blanc disparaîtrait sur le
  bandeau), sans pastille. L'encre du bouton est **calculée** par contraste
  (`_shared/email/charte.ts`, pur, testé) — le blanc tant qu'il suffit, sinon l'encre sombre. **Ni table, ni miroir** (cache court en mémoire, 5 min) et
  **jamais bloquant** : Socle muet ⇒ habillage Iris, pas un refus — l'inverse du relais
  d'envoi. Les messages aux **agents** gardent le vert d'Iris.
  Détail : [`docs/emails.md`](../emails.md).
