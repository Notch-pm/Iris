# Documents d'instruction et courriers

Fiche de feature : détail déplacé tel quel depuis `CLAUDE.md` le 2026-10-30. Les invariants de [`CLAUDE.md`](../../CLAUDE.md) priment.

- **Documents d'instruction et courriers** (2026-09-01, onglet Documents, edge function
  `generate-request-document`, modules purs `supabase/functions/_shared/document/`,
  migration `20260901140000`) : l'agent produit un document du dossier à partir d'un **modèle
  Word**, en **PDF ou en Word**, avec les variables du dossier fusionnées.
  - **Trois natures, sur la même table** (`request_attachments.kind`) : `instruction_interne`,
    `instruction_externe`, `courrier` — plus `demande` (défaut) pour les pièces de l'usager.
    Une table parallèle aurait dupliqué les policies, la purge RGPD et la qualification.
  - ⚠️ **L'INVARIANT DU LOT : un document interne ne sort JAMAIS.** Miroir de la règle des
    notes internes, et gardé à trois niveaux — le trigger
    `t05_attachments_internal_never_sent` (qui vaut aussi pour le `service_role`), la RPC
    `start_request_email` qui refuse un interne désigné par identifiant, et l'edge function
    d'envoi qui relit la nature avant même d'ouvrir l'échange. L'écran, lui, ne fait que
    refléter : pas de bouton « Joindre à un échange » sur un interne.
  - **La fusion est un travail de chaîne, et le piège est connu** : Word ne garde pas un jeton
    d'un seul tenant. `{{usager.nom}}` se retrouve couramment coupé en cinq runs
    (`{{`, `usager`, `.no`, `m`, `}}`) par le correcteur ou une révision. `docxMerge.ts`
    travaille donc **paragraphe par paragraphe** : il recolle le texte de tous les `<w:t>`,
    cherche les jetons dessus, puis redistribue le résultat — la mise en forme du run où le
    jeton commence l'emporte. Un remplacement naïf sur le XML ne trouverait rien.
  - **Ce que le catalogue porte** (`_shared/document/variables.ts`, contrat recopié dans les
    modèles des collectivités : on AJOUTE, on ne renomme pas) : `usager.*` (identité relue
    dans le Socle, bloc adresse d'un seul tenant), `demande.*` (démarche, code de suivi,
    dates, urgence, état, instructeur), `organisme.*` (nom, adresse, charte), et une **boucle**
    `{{#demande.pieces}} … {{libelle}} : {{statut}} … {{/demande.pieces}}`. Vérifié sur le
    document de référence fourni par le PO : 35 variables, 1 boucle, **0 jeton inconnu**.
  - **Un jeton hors catalogue est laissé tel quel**, délibérément : le modèle appartient à la
    collectivité, et faire disparaître silencieusement `{{ma_variable}}` la laisserait sans
    explication devant un courrier incomplet. L'aperçu les liste avant de produire.
  - **Les variables d'IMAGE (`organisme.logo_url`) rendent du vide**, pas leur URL : coller une
    adresse dans un courrier serait pire que rien. Le logo d'un pli vit dans l'en-tête du
    modèle Word — et le .docx le recopie à l'octet près.
  - **Word = identique au modèle** (le zip est rouvert, seules les parties textuelles sont
    réécrites). **PDF = REDESSINÉ par Iris** (`docxParse` → `pdfLayout` → `pdfRender`, pdf-lib) :
    décision PO du 2026-09-01, aucun convertisseur externe, aucun courrier d'usager envoyé à un
    tiers. Le prix est écrit à l'écran avant de générer : police substituée, images et
    en-têtes non repris, listes numérotées en puces. Le PDF sait faire : paragraphes, gras /
    italique / souligné, tailles, couleurs, alignements (justification comprise), retraits,
    interlignes, styles nommés avec chaîne `basedOn`, tableaux simples bordés, sauts de page,
    format et marges de la section.
  - **Le contexte de fusion est composé CÔTÉ SERVEUR**, jamais accepté du navigateur — même
    règle que l'e-mail à l'usager et le prompt de l'assistant. Un client qui dicterait
    `{{organisme.nom}}` signerait un courrier de la collectivité avec le contenu de son choix.
    Droit exigé : **instruction** sur le couple, comme pour déposer une pièce.
  - **Joindre un document à un échange crée une LIGNE de plus, pas un fichier de plus** : même
    `storage_path`, `email_id` posé, `source_attachment_id` vers l'original — qui reste au
    dossier et peut repartir dans un second message. Le composeur reçoit le document par un
    brouillon partiel (`ComposerDraft.documentIds`) : joindre n'efface jamais ce que l'agent
    est en train d'écrire.
  - **LES MODÈLES VIENNENT DU SOCLE** (contrat public-api **1.6.0**, brief du 2026-09-01,
    branché le même jour) : `GET /v1/procedures/{id}` porte un bloc `documents`
    (`restrict_visibility` + `items`), relayé au navigateur par la whitelist de
    `socle-proxy /v1/procedures/get`. L'écran ne propose donc que ce que le paramétreur a
    choisi, démarche par démarche.
    - ⚠️ **LA RÈGLE D'AFFICHAGE, ET SON PIÈGE** (`templates.ts`, pur et testé) :
      `restrict_visibility` se lit AVANT `visibility`. Les conditions sont **conservées**
      quand le paramétreur désactive la restriction — un modèle « negative » doit donc
      s'afficher TOUJOURS si la restriction est levée. L'ignorer masquerait des documents que
      la collectivité a rendus visibles. Tant que la demande n'est pas close, ni « positive »
      ni « negative » ne s'appliquent (`closureOutcome` : `annulee` et `archivee` ne sont NI
      l'une NI l'autre).
    - **Le fichier ne transite jamais par le navigateur** : le client n'envoie qu'un
      `template_id`, et l'edge function RECHARGE la démarche pour vérifier que ce modèle est
      bien l'un de ses `items` avant de demander l'URL signée (5 min, jamais stockée) et de
      télécharger. Sans cette confrontation, la fonction serait un lecteur libre du bucket
      `document-templates` dans tout le périmètre de la clé Socle — même défense que
      `/v1/procedures/document-url` pour la base de connaissances.
    - **La NATURE vient du modèle**, plus de l'agent : `type` (`interne`/`externe`/`courrier`)
      décide de `kind`. Le paramétreur a déjà dit ce qu'était le document ; le redemander à
      l'agent, c'était lui permettre de faire sortir un interne.
    - **Le Socle ne convertit rien** : il rend le fichier tel qu'il a été déposé (`.doc`,
      `.docx`, `.odt`). La fusion ne sait ouvrir qu'un `.docx` — le refus est explicite et dit
      quoi faire (`unmergeableReason`), à l'écran comme au serveur.
  - Tests : `docxMerge.test.ts`, `docxParse.test.ts`, `pdfLayout.test.ts`, `context.test.ts`,
    `templates.test.ts` (78 cas, modules purs — dont le piège `restrict_visibility`) + `documents.test.ts` côté écran + le test SQL transactionnel
    `supabase/tests/documents-instruction.test.sql` (14 assertions, dont les trois niveaux de
    garde de l'invariant).
