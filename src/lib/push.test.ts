import { describe, expect, it } from "vitest";
import {
  deviceLabel,
  isApplePlatform,
  PUSH_COPY,
  resolvePushState,
  subscriptionToRow,
  urlBase64ToUint8Array,
  type PushEnv,
} from "./push";

function env(over: Partial<PushEnv> = {}): PushEnv {
  return {
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    isApplePlatform: false,
    isStandalone: false,
    permission: "default",
    publicKey: "BPub",
    hasBrowserSubscription: false,
    rowIsMine: false,
    ...over,
  };
}

describe("resolvePushState", () => {
  it("navigateur capable, sans abonnement → off", () => {
    expect(resolvePushState(env())).toBe("off");
  });

  it("abonnement du navigateur ET ligne à moi → on", () => {
    expect(resolvePushState(env({ permission: "granted", hasBrowserSubscription: true, rowIsMine: true }))).toBe("on");
  });

  it("abonnement du navigateur sans ligne à moi (autre titulaire, ligne retirée) → off", () => {
    expect(resolvePushState(env({ permission: "granted", hasBrowserSubscription: true, rowIsMine: false }))).toBe("off");
  });

  it("permission refusée → denied, même avec un abonnement", () => {
    expect(resolvePushState(env({ permission: "denied", hasBrowserSubscription: true, rowIsMine: true }))).toBe("denied");
  });

  it("clé publique absente → not_configured (rien ne casse)", () => {
    expect(resolvePushState(env({ publicKey: " " }))).toBe("not_configured");
  });

  it("iPhone hors app installée : Safari n'expose pas PushManager → needs_install", () => {
    expect(resolvePushState(env({ hasPushManager: false, isApplePlatform: true, isStandalone: false }))).toBe("needs_install");
  });

  it("iPhone en app installée mais capacité absente (iOS < 16.4) → unsupported", () => {
    expect(resolvePushState(env({ hasPushManager: false, isApplePlatform: true, isStandalone: true }))).toBe("unsupported");
  });

  it("navigateur sans service worker → unsupported", () => {
    expect(resolvePushState(env({ hasServiceWorker: false }))).toBe("unsupported");
  });

  it("chaque état a un texte", () => {
    for (const state of ["on", "off", "denied", "needs_install", "unsupported", "not_configured"] as const) {
      expect(PUSH_COPY[state].hint.length).toBeGreaterThan(10);
    }
  });
});

describe("urlBase64ToUint8Array", () => {
  it("décode le base64url sans remplissage", () => {
    // "Iris!" → SXJpcyE= en base64 ; en base64url sans padding : SXJpcyE
    expect(Array.from(urlBase64ToUint8Array("SXJpcyE"))).toEqual([73, 114, 105, 115, 33]);
  });

  it("traduit - et _", () => {
    // 0xfb 0xff → +/8= en base64, -_8 en base64url
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("subscriptionToRow", () => {
  const ua = "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36";

  it("mappe endpoint et clés, avec un libellé d'appareil", () => {
    expect(subscriptionToRow({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "P", auth: "A" } }, ua))
      .toEqual({ endpoint: "https://fcm.googleapis.com/x", p256dh: "P", auth: "A", user_agent: "Android · Chrome" });
  });

  it("refuse un abonnement incomplet ou non https", () => {
    expect(subscriptionToRow({ endpoint: "https://x", keys: { p256dh: "P" } }, ua)).toBeNull();
    expect(subscriptionToRow({ endpoint: "http://x", keys: { p256dh: "P", auth: "A" } }, ua)).toBeNull();
    expect(subscriptionToRow({ keys: { p256dh: "P", auth: "A" } }, ua)).toBeNull();
  });
});

describe("deviceLabel", () => {
  it("reconnaît les couples courants", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/130.0")).toBe("Mac · Firefox");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; SAMSUNG) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36")).toBe("Android · Samsung Internet");
    expect(deviceLabel("")).toBe("Appareil · navigateur");
  });
});

describe("isApplePlatform", () => {
  it("iPhone, iPad, et l'iPad déguisé en Mac", () => {
    expect(isApplePlatform("Mozilla/5.0 (iPhone; …)", "iPhone", 5)).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });
});
