// Le bloc « Lieu d'intervention » d'une démarche, saisi comme une adresse et
// non comme sept champs séparés.
//
// Rien du contrat ne change : on écrit dans EXACTEMENT les champs que la
// démarche pose (`onChange(field.id, …)`, comme n'importe quel champ du
// formulaire), et la reconnaissance du bloc est la même qu'à la relecture
// d'une demande (`interventionFields`). Si la démarche n'a pas de champ pour
// une partie de l'adresse, cette partie n'est pas inventée : elle rejoint la
// voie (`fitStreetParts`).

import * as React from "react";
import { AddressField } from "@/components/address/AddressField";
import { useQuartiers } from "@/features/socle/useQuartiers";
import { useTenant } from "@/features/tenant/TenantProvider";
import { splitStreetLine, streetLine, toInterventionParts } from "@/lib/adresse";
import type { FlatField, FormValues } from "@fn/create-request-from-procedure/_shared/procedureForm";
import { fitStreetParts, type AddressPart } from "../instruction/lieu";
import { displayFieldValue, optionValueFor } from "./model";

/** Précisions d'accès du bloc : dépliées par « Plus de champs », jamais géocodées. */
const EXTRA_PARTS: AddressPart[] = ["batiment", "appartement", "complement"];

const EXTRA_LABELS: Record<string, string> = {
  batiment: "Bâtiment",
  appartement: "Appartement",
  complement: "Complément d'adresse",
};

interface Props {
  fields: Map<AddressPart, FlatField>;
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
  errors: Record<string, string>;
}

export function InterventionAddress({ fields, values, onChange, errors }: Props) {
  // ⚠️ La ligne affichée ne peut PAS être recomposée depuis les champs séparés
  // pendant la frappe : le découpage normalise les espaces, si bien qu'un
  // « 12 » suivi d'une espace redevient « 12 » et que la lettre suivante se
  // recolle (« 12b » → numéro 12, BTQ « b »…). Vécu en navigateur le
  // 2026-08-28 : la saisie donnait « 12 Bisruedeslilasarles ».
  //
  // Tant que l'agent tape, c'est SA ligne qui s'affiche ; les champs du bloc
  // sont alimentés à côté. Retenir une proposition rend la main aux champs
  // (`null`), qui portent alors le libellé canonique du référentiel.
  const [typed, setTyped] = React.useState<string | null>(null);
  const { current } = useTenant();
  const { quartiers } = useQuartiers(current?.organizationId ?? "");
  const entryOf = (part: AddressPart) => fields.get(part) ?? null;
  const has = (part: AddressPart) => fields.has(part);

  /** Valeur lisible (libellé d'option pour un select, comme sur la fiche). */
  const shown = (part: AddressPart): string => {
    const entry = entryOf(part);
    return entry ? displayFieldValue(entry.field, values[entry.field.id]).trim() : "";
  };
  const set = (part: AddressPart, value: string) => {
    const entry = entryOf(part);
    if (entry) onChange(entry.field.id, value);
  };

  const btqField = entryOf("btq")?.field ?? null;
  const applyStreet = (parts: { numero: string; btq: string; voie: string }) => {
    const fitted = fitStreetParts(parts, has, (text) =>
      btqField ? optionValueFor(btqField, text) : null);
    set("numero", fitted.numero);
    set("btq", fitted.btq);
    set("voie", fitted.voie);
  };

  const composed = streetLine({ numero: shown("numero"), btq: shown("btq"), voie: shown("voie") });
  const line = typed ?? composed;
  const extras = EXTRA_PARTS.filter(has).map((part) => {
    const entry = entryOf(part)!;
    return {
      key: part,
      label: entry.field.label.trim() || EXTRA_LABELS[part]!,
      value: shown(part),
      maxLength: "maxLength" in entry.field ? entry.field.maxLength : undefined,
    };
  });

  // L'erreur du champ « voie » (souvent le seul obligatoire du bloc) porte pour
  // la ligne unique : c'est elle que l'agent vient de remplir.
  const requiredEntry = entryOf("voie") ?? entryOf("ville");
  const error = React.useMemo(
    () => [...fields.values()].map((entry) => errors[entry.field.id]).find(Boolean),
    [fields, errors],
  );

  return (
    <AddressField
      id="pf-lieu-intervention"
      label="Adresse du lieu d'intervention"
      quartiers={quartiers}
      required={requiredEntry?.field.required ?? false}
      error={error}
      value={{ line, postcode: shown("code_postal"), city: shown("ville") }}
      onChange={(next, suggestion) => {
        if (suggestion) {
          const parts = toInterventionParts(suggestion);
          setTyped(null);
          applyStreet(parts);
          set("code_postal", parts.code_postal);
          set("ville", parts.ville);
          return;
        }
        setTyped(next.line);
        applyStreet(splitStreetLine(next.line));
        set("code_postal", next.postcode);
        set("ville", next.city);
      }}
      extras={extras}
      onExtraChange={(key, value) => set(key as AddressPart, value)}
    />
  );
}
