import { describe, expect, it } from "vitest";
import { discardReceived, receiveFile, type StorageBucketLike } from "./receive";
import { sha256HexOf } from "./checksum";
import { pdfBytes, svgBytes } from "./fixtures";

interface Call { path: string; contentType: string; upsert: boolean; size: number }

function fakeBucket(failUpload = false) {
  const uploads: Call[] = [];
  const removed: string[][] = [];
  const bucket: StorageBucketLike = {
    async upload(path, body, options) {
      uploads.push({ path, contentType: options.contentType, upsert: options.upsert, size: body.length });
      return { error: failUpload ? { message: "quota" } : null };
    },
    async remove(paths) {
      removed.push(paths);
      return { error: null };
    },
  };
  return { bucket, uploads, removed };
}

describe("receiveFile — la porte unique", () => {
  it("inspecte, hache, puis écrit avec le type DÉTECTÉ et sans écrasement", async () => {
    const { bucket, uploads } = fakeBucket();
    const bytes = pdfBytes();
    const r = await receiveFile(bucket, { path: "org/_staging/u1", bytes, fileName: "scan.pdf", maxBytes: 1_000_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("application/pdf");
      expect(r.size).toBe(bytes.length);
      expect(r.checksum).toBe(await sha256HexOf(bytes));
      expect(r.inline).toBe(true);
    }
    expect(uploads).toEqual([{ path: "org/_staging/u1", contentType: "application/pdf", upsert: false, size: bytes.length }]);
  });

  it("n'écrit RIEN quand l'inspection refuse", async () => {
    const { bucket, uploads } = fakeBucket();
    const r = await receiveFile(bucket, { path: "org/_staging/u2", bytes: svgBytes(), fileName: "x.svg", maxBytes: 1_000_000 });
    expect(r).toMatchObject({ ok: false, code: "unsupported_media_type" });
    expect(uploads).toHaveLength(0);
  });

  it("relaie un échec d'écriture et sait retirer l'objet en compensation", async () => {
    const { bucket, removed } = fakeBucket(true);
    const r = await receiveFile(bucket, { path: "org/_staging/u3", bytes: pdfBytes(), fileName: "a.pdf", maxBytes: 1_000_000 });
    expect(r).toMatchObject({ ok: false, code: "storage_failed" });
    await discardReceived(bucket, "org/_staging/u3");
    expect(removed).toEqual([["org/_staging/u3"]]);
  });
});

describe("sha256HexOf", () => {
  it("calcule le vecteur de test connu, y compris sur une vue décalée", async () => {
    const abc = new TextEncoder().encode("abc");
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256HexOf(abc)).toBe(expected);
    const padded = new Uint8Array([0, 0, ...abc, 0]);
    expect(await sha256HexOf(padded.subarray(2, 5))).toBe(expected);
  });
});
