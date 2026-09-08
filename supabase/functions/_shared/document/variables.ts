// Variables de fusion des documents — CATALOGUE et résolution. Module PUR
// (aucune dépendance Deno, aucun réseau), testé par vitest.
//
// ⚠️ LE CATALOGUE EST UN CONTRAT. Il est recopié tel quel dans les modèles Word
// des collectivités, accolades comprises : renommer une clé, c'est casser tous
// les modèles déjà écrits. On AJOUTE, on ne renomme pas.
//
// Trois groupes, tels que le document de référence les nomme :
//   · `usager.*`      — l'identité RELUE (fiche Socle) ou, à défaut, celle du
//                       dépôt (`requester_snapshot`) ;
//   · `demande.*`     — le dossier, ses dates, son instructeur, ses pièces ;
//   · `organisme.*`   — la collectivité émettrice et sa charte (héritage déjà
//                       résolu par le Socle, comme pour les e-mails).
//
// Et une BOUCLE : `{{#demande.pieces}} … {{libelle}} : {{statut}} … {{/demande.pieces}}`,
// dont les clés sont RELATIVES à l'élément.
//
// ⚠️ Ce catalogue n'est PAS celui des modèles d'e-mail
// (`src/features/templates/templates.ts`, jumeau SQL, FIGÉ) : ce sont deux
// contrats, deux publics, deux cycles de vie. Un courrier a besoin du bloc
// adresse et de la charte ; un e-mail, non.

/** Une variable du catalogue, telle qu'elle se documente pour un rédacteur. */
export interface DocumentVariable {
  /** Clé sans accolades — « usager.nom ». */
  key: string;
  label: string;
  /** Ce que l'agent verra dans l'aperçu quand la valeur manque. */
  hint?: string;
  /** Variable d'IMAGE : une URL, à insérer comme image et non à coller. */
  image?: boolean;
}

export const DOCUMENT_VARIABLES: DocumentVariable[] = [
  { key: "usager.nom", label: "Nom" },
  { key: "usager.prenom", label: "Prénom" },
  { key: "usager.civilite", label: "Civilité", hint: "Madame, Monsieur" },
  { key: "usager.adresse_complete", label: "Adresse complète", hint: "Bloc adresse, sauts de ligne compris" },
  { key: "usager.numero", label: "Numéro", hint: "Non porté par le contrat Socle" },
  { key: "usager.btq", label: "Bis / Ter / Quater", hint: "Non porté par le contrat Socle" },
  { key: "usager.voie", label: "Voie" },
  { key: "usager.complement", label: "Complément d'adresse" },
  { key: "usager.appartement", label: "Appartement", hint: "Non porté par le contrat Socle" },
  { key: "usager.batiment", label: "Bâtiment", hint: "Non porté par le contrat Socle" },
  { key: "usager.code_postal", label: "Code postal" },
  { key: "usager.ville", label: "Ville" },
  { key: "usager.telephone_mobile", label: "Téléphone mobile" },
  { key: "usager.telephone_fixe", label: "Téléphone fixe" },
  { key: "usager.courriel", label: "Adresse courriel" },
  { key: "usager.quartier", label: "Quartier" },

  { key: "demande.libelle_demarche", label: "Libellé de la démarche" },
  { key: "demande.code_suivi", label: "Code de suivi" },
  { key: "demande.categorie", label: "Catégorie" },
  { key: "demande.organisme_responsable", label: "Organisme responsable" },
  { key: "demande.date_depot", label: "Date de dépôt" },
  { key: "demande.date_echeance", label: "Date d'échéance" },
  { key: "demande.urgence", label: "Urgence" },
  { key: "demande.etat_actuel", label: "État actuel" },
  { key: "demande.date_cloture", label: "Date de clôture" },
  { key: "demande.etat_cloture", label: "État à la clôture", hint: "Positive ou négative" },
  { key: "demande.agent_nom", label: "Agent instructeur — nom" },
  { key: "demande.agent_prenom", label: "Agent instructeur — prénom" },
  { key: "demande.agent_courriel", label: "Agent instructeur — courriel" },

  { key: "organisme.nom", label: "Nom de l'organisme" },
  { key: "organisme.adresse", label: "Adresse de l'organisme" },
  { key: "organisme.telephone", label: "Téléphone" },
  { key: "organisme.courriel", label: "Adresse courriel" },
  { key: "organisme.couleur_principale", label: "Couleur principale", hint: "#rrggbb" },
  { key: "organisme.couleur_secondaire", label: "Couleur secondaire", hint: "#rrggbb" },
  { key: "organisme.logo_url", label: "Logo (couleur)", image: true },
  { key: "organisme.logo_blanc_url", label: "Logo blanc", image: true },
];

/** Boucles connues : clé du bloc → clés relatives acceptées à l'intérieur. */
export const DOCUMENT_LOOPS: Record<string, DocumentVariable[]> = {
  "demande.pieces": [
    { key: "libelle", label: "Libellé de la pièce" },
    { key: "statut", label: "Statut de qualification" },
    { key: "fichier", label: "Nom du fichier" },
  ],
};

const VARIABLE_KEYS = new Set(DOCUMENT_VARIABLES.map((v) => v.key));
const IMAGE_KEYS = new Set(DOCUMENT_VARIABLES.filter((v) => v.image).map((v) => v.key));

export function isKnownVariable(key: string): boolean {
  return VARIABLE_KEYS.has(key);
}

/**
 * Variable d'IMAGE. Elles sont reconnues mais **pas encore insérées** : coller
 * l'URL dans un courrier serait pire que de ne rien mettre, donc elles rendent
 * du vide et l'écran le dit. Le logo d'un courrier vit de toute façon dans
 * l'en-tête du modèle Word, pas dans une variable.
 */
export function isImageVariable(key: string): boolean {
  return IMAGE_KEYS.has(key);
}

export function isKnownLoop(key: string): boolean {
  return Object.hasOwn(DOCUMENT_LOOPS, key);
}

// ---- Contexte de fusion -----------------------------------------------------

/** Une pièce du dossier, telle qu'une boucle la voit. */
export interface PieceValue {
  libelle: string;
  statut: string;
  fichier: string;
}

/** Ce que l'appelant (l'edge function) a rassemblé pour une demande. */
export interface MergeInput {
  usager: {
    civilite?: string | null;
    prenom?: string | null;
    nom?: string | null;
    voie?: string | null;
    complement?: string | null;
    code_postal?: string | null;
    ville?: string | null;
    telephone_mobile?: string | null;
    telephone_fixe?: string | null;
    courriel?: string | null;
    quartier?: string | null;
  };
  demande: {
    libelle_demarche?: string | null;
    code_suivi?: string | null;
    categorie?: string | null;
    organisme_responsable?: string | null;
    date_depot?: string | null;
    date_echeance?: string | null;
    urgence?: string | null;
    etat_actuel?: string | null;
    date_cloture?: string | null;
    etat_cloture?: string | null;
    agent_nom?: string | null;
    agent_prenom?: string | null;
    agent_courriel?: string | null;
    pieces?: PieceValue[];
  };
  organisme: {
    nom?: string | null;
    adresse?: string | null;
    telephone?: string | null;
    courriel?: string | null;
    couleur_principale?: string | null;
    couleur_secondaire?: string | null;
  };
}

/** Valeurs plates prêtes pour la fusion, plus les listes des boucles. */
export interface MergeContext {
  values: Record<string, string>;
  lists: Record<string, Record<string, string>[]>;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Bloc adresse d'un seul tenant : voie, complément, puis « 13200 Arles ».
 * Les lignes vides disparaissent — un courrier ne porte pas de ligne blanche
 * parce qu'une fiche n'a pas de complément d'adresse.
 */
export function adresseComplete(usager: MergeInput["usager"]): string {
  return [
    clean(usager.voie),
    clean(usager.complement),
    [clean(usager.code_postal), clean(usager.ville)].filter((p) => p !== "").join(" "),
  ].filter((line) => line !== "").join("\n");
}

/**
 * Contexte de fusion. Toute variable du catalogue y figure, même vide : une
 * clé absente laisserait le jeton visible dans le courrier, ce qui est pire
 * qu'un blanc. Les variables d'image rendent du vide (voir `isImageVariable`).
 */
export function buildMergeContext(input: MergeInput): MergeContext {
  const values: Record<string, string> = {};
  for (const v of DOCUMENT_VARIABLES) values[v.key] = "";

  const u = input.usager;
  values["usager.civilite"] = clean(u.civilite);
  values["usager.prenom"] = clean(u.prenom);
  values["usager.nom"] = clean(u.nom);
  values["usager.voie"] = clean(u.voie);
  values["usager.complement"] = clean(u.complement);
  values["usager.code_postal"] = clean(u.code_postal);
  values["usager.ville"] = clean(u.ville);
  values["usager.telephone_mobile"] = clean(u.telephone_mobile);
  values["usager.telephone_fixe"] = clean(u.telephone_fixe);
  values["usager.courriel"] = clean(u.courriel);
  values["usager.quartier"] = clean(u.quartier);
  values["usager.adresse_complete"] = adresseComplete(u);

  const d = input.demande;
  values["demande.libelle_demarche"] = clean(d.libelle_demarche);
  values["demande.code_suivi"] = clean(d.code_suivi);
  values["demande.categorie"] = clean(d.categorie);
  values["demande.organisme_responsable"] = clean(d.organisme_responsable);
  values["demande.date_depot"] = clean(d.date_depot);
  values["demande.date_echeance"] = clean(d.date_echeance);
  values["demande.urgence"] = clean(d.urgence);
  values["demande.etat_actuel"] = clean(d.etat_actuel);
  values["demande.date_cloture"] = clean(d.date_cloture);
  values["demande.etat_cloture"] = clean(d.etat_cloture);
  values["demande.agent_nom"] = clean(d.agent_nom);
  values["demande.agent_prenom"] = clean(d.agent_prenom);
  values["demande.agent_courriel"] = clean(d.agent_courriel);

  const o = input.organisme;
  values["organisme.nom"] = clean(o.nom);
  values["organisme.adresse"] = clean(o.adresse);
  values["organisme.telephone"] = clean(o.telephone);
  values["organisme.courriel"] = clean(o.courriel);
  values["organisme.couleur_principale"] = clean(o.couleur_principale);
  values["organisme.couleur_secondaire"] = clean(o.couleur_secondaire);

  const lists: Record<string, Record<string, string>[]> = {
    "demande.pieces": (d.pieces ?? []).map((p) => ({
      libelle: clean(p.libelle),
      statut: clean(p.statut),
      fichier: clean(p.fichier),
    })),
  };

  return { values, lists };
}
