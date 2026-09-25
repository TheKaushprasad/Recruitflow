import { test } from "node:test";
import assert from "node:assert/strict";
import { relatedJobs, titleSimilarity } from "../src/lib/related.ts";

const job = (id: string, title: string, based_on_job_id: string | null = null) => ({ id, title, based_on_job_id });

test("similar titles match, unrelated ones don't", () => {
  assert.ok(titleSimilarity("Senior Frontend Engineer", "Frontend Engineer") >= 0.5);
  assert.equal(titleSimilarity("Senior Frontend Engineer", "Accountant"), 0);
});

test("lineage outranks title similarity", () => {
  const jobs = [job("a", "Frontend Engineer"), job("b", "Data Analyst"), job("c", "Backend Engineer", "t")];
  const r = relatedJobs({ id: "new", title: "Senior Frontend Engineer", based_on_job_id: "b" }, jobs);
  assert.equal(r[0].job.id, "b");
  assert.equal(r[0].relation, "template");
  assert.ok(r.some((x) => x.job.id === "a" && x.relation === "similar title"));
});

test("children and siblings are related; self is excluded", () => {
  const jobs = [job("p", "Designer"), job("k1", "Product Designer", "p"), job("k2", "Visual Designer", "p")];
  const fromParent = relatedJobs({ id: "p", title: "Designer" }, jobs);
  assert.deepEqual(fromParent.map((x) => x.relation).sort(), ["created from this", "created from this"]);
  const sib = relatedJobs(jobs[1], jobs);
  assert.ok(sib.some((x) => x.job.id === "k2" && x.relation === "same template"));
  assert.ok(!sib.some((x) => x.job.id === "k1"));
});
