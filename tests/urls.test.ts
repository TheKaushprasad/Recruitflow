import { test } from "node:test";
import assert from "node:assert/strict";
import { directCvUrl, githubUser, normalizeUrl } from "../src/lib/urls.ts";

test("Google Drive and Docs share links become direct downloads", () => {
  assert.equal(
    directCvUrl("https://drive.google.com/file/d/1ZUlElZvLLm1SuRZzBrYf74g-0MgUgiWo/view?usp=sharing"),
    "https://drive.google.com/uc?export=download&id=1ZUlElZvLLm1SuRZzBrYf74g-0MgUgiWo",
  );
  assert.equal(
    directCvUrl("https://drive.google.com/open?id=1ZUlElZvLLm1SuRZzBrYf74g-0MgUgiWo"),
    "https://drive.google.com/uc?export=download&id=1ZUlElZvLLm1SuRZzBrYf74g-0MgUgiWo",
  );
  assert.equal(
    directCvUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"),
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=pdf",
  );
});

test("Dropbox links are forced to download; others unchanged", () => {
  assert.equal(directCvUrl("https://www.dropbox.com/s/abc/cv.pdf?dl=0"), "https://www.dropbox.com/s/abc/cv.pdf?dl=1");
  assert.equal(directCvUrl("https://example.com/me/cv.pdf"), "https://example.com/me/cv.pdf");
});

test("normalizeUrl accepts bare domains and GitHub usernames, rejects junk", () => {
  assert.equal(normalizeUrl("www.jane.dev"), "https://www.jane.dev");
  assert.equal(normalizeUrl("github.com/jane-doe"), "https://github.com/jane-doe");
  assert.equal(normalizeUrl("jane-doe", "github"), "https://github.com/jane-doe");
  assert.equal(normalizeUrl("@jane-doe", "github"), "https://github.com/jane-doe");
  assert.equal(normalizeUrl("jane-doe"), null);
  assert.equal(normalizeUrl("see my CV"), null);
  assert.equal(normalizeUrl("  "), null);
});

test("githubUser extracts user and repo, ignores site pages", () => {
  assert.deepEqual(githubUser("https://github.com/jane-doe"), { user: "jane-doe", repo: undefined });
  assert.deepEqual(githubUser("https://github.com/jane-doe/cool-app"), { user: "jane-doe", repo: "cool-app" });
  assert.equal(githubUser("https://github.com/features/copilot"), null);
  assert.equal(githubUser("https://gitlab.com/jane"), null);
});
