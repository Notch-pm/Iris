import { describe, expect, it } from "vitest";
import { readSsoReturnError, ssoSignInCredentials, SSO_PROVIDER } from "./sso";

describe("ssoSignInCredentials", () => {
  it("demande le provider keycloak avec le scope openid et revient sur /login", () => {
    expect(ssoSignInCredentials("https://iris.edilumen.fr")).toEqual({
      provider: "keycloak",
      options: { scopes: "openid", redirectTo: "https://iris.edilumen.fr/login" },
    });
    expect(SSO_PROVIDER).toBe("keycloak");
  });

  it("n'envoie aucun kc_idp_hint : Keycloak oriente lui-même par le domaine", () => {
    const creds = ssoSignInCredentials("http://localhost:5174");
    expect(JSON.stringify(creds)).not.toContain("kc_idp_hint");
  });
});

describe("readSsoReturnError", () => {
  it("rien dans l'URL → pas d'erreur", () => {
    expect(readSsoReturnError("", "")).toBeNull();
    expect(readSsoReturnError("?from=/organisations", "#access_token=abc")).toBeNull();
  });

  it("agent non provisionné (inscriptions fermées), par le code", () => {
    const err = readSsoReturnError(
      "?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
      "",
    );
    expect(err?.message).toMatch(/n'a pas accès à Iris/);
  });

  it("agent non provisionné, par le seul texte et dans le fragment", () => {
    const err = readSsoReturnError(
      "",
      "#error=server_error&error_description=Signups%20not%20allowed%20for%20this%20instance",
    );
    expect(err?.message).toMatch(/n'a pas accès à Iris/);
  });

  it("compte suspendu (banni par set_user_status)", () => {
    const err = readSsoReturnError("?error=access_denied&error_description=User+is+banned", "");
    expect(err?.message).toMatch(/suspendu/);
  });

  it("toute autre erreur → message générique qui propose le mot de passe", () => {
    const err = readSsoReturnError(
      "?error=invalid_request&error_description=Unsupported+provider%3A+provider+is+not+enabled",
      "",
    );
    expect(err?.message).toMatch(/mot de passe/);
  });

  it("un code sans `error` suffit à signaler l'échec", () => {
    expect(readSsoReturnError("?error_code=unexpected_failure", "")).not.toBeNull();
  });
});
