import test from "node:test";
import assert from "node:assert/strict";
import { MAX_MARKDOWN_UPLOAD_BYTES, validateMarkdownUpload } from "../src/lib/submission-upload.ts";

test("markdown upload accepts a normal UTF-8 markdown file", () => {
  assert.deepEqual(validateMarkdownUpload("report.md", "# 제목\n\n본문"), {
    ok: true,
    bytes: new TextEncoder().encode("# 제목\n\n본문").byteLength,
    filename: "report.md",
  });
  assert.equal(validateMarkdownUpload("REPORT.MD", "본문").ok, true);
});

test("markdown upload rejects wrong extension, unsafe basename, blank body and frontmatter", () => {
  for (const [name, body] of [
    ["report.pdf", "body"],
    ["../report.md", "body"],
    ["folder/report.md", "body"],
    ["report.md", "   \n"],
    ["report.md", "---\ntitle: injected\n---\nbody"],
    ["report.md", "\0bad"],
  ]) {
    assert.equal(validateMarkdownUpload(name, body).ok, false, `${name} should be rejected`);
  }
});

test("markdown upload size is measured in UTF-8 bytes", () => {
  assert.equal(validateMarkdownUpload("report.md", "a".repeat(MAX_MARKDOWN_UPLOAD_BYTES)).ok, true);
  assert.equal(validateMarkdownUpload("report.md", "가".repeat(Math.ceil(MAX_MARKDOWN_UPLOAD_BYTES / 3))).ok, false);
});
