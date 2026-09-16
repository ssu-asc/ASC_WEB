export const MAX_MARKDOWN_UPLOAD_BYTES = 262_144;

export type MarkdownUploadValidation =
  | { ok: true; bytes: number; filename: string }
  | { ok: false; message: string };

export interface SubmissionDraft {
  summary: string;
  code_repository_url: string;
  report_filename: string;
  report_markdown: string;
}

function isGithubRepositoryUrl(value: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value.trim());
}

export function validateMarkdownUpload(filename: string, markdown: string): MarkdownUploadValidation {
  const safeName = filename.trim();
  if (!safeName || safeName.length > 128 || safeName.includes("/") || safeName.includes("\\") || safeName === "." || safeName === "..") {
    return { ok: false, message: "보고서 파일 이름을 확인해 주세요." };
  }
  if (!safeName.toLowerCase().endsWith(".md")) {
    return { ok: false, message: "보고서는 .md 파일로 올려 주세요." };
  }
  if (markdown.includes("\0")) {
    return { ok: false, message: "보고서에 사용할 수 없는 문자가 포함되어 있습니다." };
  }
  if (!markdown.trim()) {
    return { ok: false, message: "빈 Markdown 파일은 제출할 수 없습니다." };
  }
  if (markdown.trimStart().startsWith("---")) {
    return { ok: false, message: "YAML frontmatter는 ASC_WEB이 자동 생성합니다. 본문만 올려 주세요." };
  }
  const bytes = new TextEncoder().encode(markdown).byteLength;
  if (bytes < 1 || bytes > MAX_MARKDOWN_UPLOAD_BYTES) {
    return { ok: false, message: "Markdown 보고서는 256 KiB 이하로 올려 주세요." };
  }
  return { ok: true, bytes, filename: safeName };
}

export function validateSubmissionDraft(draft: SubmissionDraft): { ok: true; bytes: number } | { ok: false; message: string } {
  if (draft.summary.length > 4000) return { ok: false, message: "설명은 4000자 이하로 입력해 주세요." };
  if (draft.code_repository_url.trim() && !isGithubRepositoryUrl(draft.code_repository_url)) {
    return { ok: false, message: "코드 저장소는 GitHub 저장소 주소로 입력해 주세요." };
  }
  const report = validateMarkdownUpload(draft.report_filename, draft.report_markdown);
  if (!report.ok) return report;
  return { ok: true, bytes: report.bytes };
}
