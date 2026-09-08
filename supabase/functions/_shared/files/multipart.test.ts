import { describe, expect, it } from "vitest";
import { readSingleFileForm } from "./multipart";
import { pdfBytes } from "./fixtures";

function formRequest(build: (f: FormData) => void, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  build(form);
  const req = new Request("http://iris.test/upload", { method: "POST", body: form });
  for (const [k, v] of Object.entries(headers)) req.headers.set(k, v);
  return req;
}

describe("readSingleFileForm", () => {
  it("lit le fichier et les champs texte", async () => {
    const req = formRequest((f) => {
      f.append("organization_id", "org-1");
      f.append("file", new File([pdfBytes()], "piece.pdf", { type: "application/pdf" }));
    });
    const r = await readSingleFileForm(req, { maxBytes: 1_000_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.name).toBe("piece.pdf");
      expect(r.file.declaredType).toBe("application/pdf");
      expect(r.file.bytes.length).toBe(pdfBytes().length);
      expect(r.fields).toEqual({ organization_id: "org-1" });
    }
  });

  it("exige un envoi multipart", async () => {
    const req = new Request("http://iris.test/upload", {
      method: "POST",
      body: JSON.stringify({ file: "AAAA" }),
      headers: { "content-type": "application/json" },
    });
    expect(await readSingleFileForm(req, { maxBytes: 100 })).toMatchObject({ ok: false, code: "bad_request" });
  });

  it("refuse AVANT lecture un corps annoncé trop gros", async () => {
    const req = new Request("http://iris.test/upload", {
      method: "POST",
      body: new Uint8Array(10),
      headers: {
        "content-type": "multipart/form-data; boundary=xyz",
        "content-length": String(200 * 1_048_576),
      },
    });
    const r = await readSingleFileForm(req, { maxBytes: 10 * 1_048_576 });
    expect(r).toMatchObject({ ok: false, code: "payload_too_large" });
    if (!r.ok) expect(r.message).toContain("10 Mo");
  });

  it("refuse un fichier plus gros que la limite même sans Content-Length utile", async () => {
    const req = formRequest((f) => {
      f.append("file", new File([new Uint8Array(2048)], "gros.bin"));
    });
    expect(await readSingleFileForm(req, { maxBytes: 1024 })).toMatchObject({ ok: false, code: "payload_too_large" });
  });

  it("refuse l'absence de fichier, un second fichier, ou un fichier sous un autre nom de champ", async () => {
    expect(await readSingleFileForm(formRequest((f) => f.append("x", "1")), { maxBytes: 1024 }))
      .toMatchObject({ ok: false, code: "bad_request" });
    expect(await readSingleFileForm(formRequest((f) => {
      f.append("file", new File([pdfBytes()], "a.pdf"));
      f.append("file", new File([pdfBytes()], "b.pdf"));
    }), { maxBytes: 1_000_000 })).toMatchObject({ ok: false, code: "bad_request" });
    expect(await readSingleFileForm(formRequest((f) => {
      f.append("piece", new File([pdfBytes()], "a.pdf"));
    }), { maxBytes: 1_000_000 })).toMatchObject({ ok: false, code: "bad_request" });
  });
});
