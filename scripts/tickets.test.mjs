import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateCatalog } from "./tickets.mjs";

function ticket(id, slug, depends_on = []) {
  return {
    id,
    slug,
    title: slug,
    milestone: "M1",
    depends_on,
    file: `docs/tickets/${String(id).padStart(3, "0")}-${slug}.md`,
  };
}

async function fixture(catalog) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tickets-"));
  const contents = new Map();
  for (const item of catalog) {
    const file = path.join(root, item.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `# ${item.title}\n`);
    contents.set(item.file, await readFile(file, "utf8"));
  }
  return { root, contents };
}

test("accepts a valid ticket DAG with existing documents", async () => {
  const catalog = [
    ticket(1, "setup"),
    ticket(2, "engine-ui", [1]),
    ticket(10, "release", [1, 2]),
  ];
  const { root, contents } = await fixture(catalog);
  try {
    assert.deepEqual(validateCatalog(catalog, { fileContents: contents }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects cycles and missing dependencies", () => {
  const catalog = [
    ticket(1, "one", [2]),
    ticket(2, "two", [1]),
    ticket(3, "three", [99]),
  ];
  const errors = validateCatalog(catalog);
  assert(errors.some((error) => error.includes("Dependency cycle")));
  assert(errors.some((error) => error.includes("missing ticket 99")));
});

test("rejects duplicate IDs", () => {
  const errors = validateCatalog([ticket(1, "one"), ticket(1, "two")]);
  assert(errors.some((error) => error.includes("duplicates id")));
});

test("rejects traversal and filename mismatches", () => {
  const item = ticket(1, "safe");
  item.file = "docs/tickets/../secret.md";
  const errors = validateCatalog([item]);
  assert(errors.some((error) => error.includes("unsafe file path")));
  assert(errors.some((error) => error.includes("file must be")));
});

test("rejects missing and empty documents", () => {
  const catalog = [ticket(1, "one"), ticket(2, "two")];
  const errors = validateCatalog(catalog, {
    fileContents: new Map([[catalog[1].file, ""]]),
  });
  assert.equal(
    errors.filter((error) => error.includes("document is missing or empty"))
      .length,
    2,
  );
});

test("rejects an empty catalog and whitespace-only documents", () => {
  assert.deepEqual(validateCatalog([]), ["Catalog must not be empty."]);
  const catalog = [ticket(1, "one")];
  assert(
    validateCatalog(catalog, {
      fileContents: new Map([[catalog[0].file, " \n\t"]]),
    }).some((error) => error.includes("document is missing or empty")),
  );
});

async function cliFixture(catalog, docs = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tickets-cli-"));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await copyFile(
    new URL("./tickets.mjs", import.meta.url),
    path.join(root, "scripts/tickets.mjs"),
  );
  await mkdir(path.join(root, "docs/tickets"), { recursive: true });
  await writeFile(
    path.join(root, "docs/tickets/index.json"),
    JSON.stringify(catalog),
  );
  for (const [relativePath, contents] of Object.entries(docs)) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return root;
}

function runCli(root, ...args) {
  return spawnSync(process.execPath, ["scripts/tickets.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("CLI show returns branch and selected document content", async () => {
  const catalog = [ticket(1, "setup"), ticket(2, "engine-ui", [1])];
  const root = await cliFixture(catalog, {
    [catalog[0].file]: "# Setup\n",
    [catalog[1].file]: "# Engine UI\n",
  });
  try {
    const result = runCli(root, "show", "1");
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.branch, "feat/ticket-001-setup");
    assert.equal(output.contents, "# Setup\n");
    assert.deepEqual(output.dependencies, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI rejects invalid and unknown IDs", async () => {
  const catalog = [ticket(1, "setup")];
  const root = await cliFixture(catalog, { [catalog[0].file]: "# Setup\n" });
  try {
    assert.notEqual(runCli(root, "show", "not-a-number").status, 0);
    assert.notEqual(runCli(root, "show", "2").status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI rejects malformed catalogs", async () => {
  const root = await cliFixture([{ id: 1 }]);
  try {
    const result = runCli(root, "check");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Ticket catalog is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
