#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FIELDS = [
  "id",
  "slug",
  "title",
  "milestone",
  "depends_on",
  "file",
];
const REQUIRED_FIELDS_SORTED = [...REQUIRED_FIELDS].sort();
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isExactTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket))
    return false;
  const keys = Object.keys(ticket).sort();
  return (
    keys.length === REQUIRED_FIELDS.length &&
    keys.every((key, index) => key === REQUIRED_FIELDS_SORTED[index])
  );
}

function expectedFile(ticket) {
  return `docs/tickets/${String(ticket.id).padStart(3, "0")}-${ticket.slug}.md`;
}

function isSafeRelativePath(value) {
  return (
    typeof value === "string" &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    path.posix.normalize(value) === value
  );
}

/**
 * Validate ticket data without reading the filesystem.
 * Pass fileContents as a Map of relative file paths to their contents when
 * document existence and emptiness should also be checked.
 */
export function validateCatalog(catalog, { fileContents } = {}) {
  const errors = [];
  if (!Array.isArray(catalog)) return ["Catalog must be an array."];
  if (catalog.length === 0) return ["Catalog must not be empty."];

  const ids = new Map();
  const slugs = new Map();
  const files = new Map();

  for (const [index, ticket] of catalog.entries()) {
    const label = `Ticket at index ${index}`;
    if (!isExactTicket(ticket)) {
      errors.push(
        `${label} must contain exactly: ${REQUIRED_FIELDS.join(", ")}.`,
      );
      continue;
    }
    if (!Number.isSafeInteger(ticket.id) || ticket.id <= 0)
      errors.push(`${label} has an invalid id.`);
    if (typeof ticket.slug !== "string" || !slugPattern.test(ticket.slug))
      errors.push(`${label} has an invalid slug.`);
    if (typeof ticket.title !== "string" || ticket.title.trim() === "")
      errors.push(`${label} has an invalid title.`);
    if (
      typeof ticket.milestone !== "string" ||
      !/^M[1-6]$/.test(ticket.milestone)
    )
      errors.push(`${label} has an invalid milestone.`);
    if (
      !Array.isArray(ticket.depends_on) ||
      ticket.depends_on.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      errors.push(`${label} has invalid dependencies.`);
    } else if (new Set(ticket.depends_on).size !== ticket.depends_on.length) {
      errors.push(`${label} has duplicate dependencies.`);
    }
    if (!isSafeRelativePath(ticket.file))
      errors.push(`${label} has an unsafe file path.`);
    if (
      Number.isSafeInteger(ticket.id) &&
      ticket.id > 0 &&
      typeof ticket.slug === "string" &&
      slugPattern.test(ticket.slug) &&
      ticket.file !== expectedFile(ticket)
    )
      errors.push(`${label} file must be ${expectedFile(ticket)}.`);

    for (const [seen, kind] of [
      [ids, "id"],
      [slugs, "slug"],
      [files, "file"],
    ]) {
      const value = kind === "id" ? ticket.id : ticket[kind];
      if (seen.has(value))
        errors.push(`${label} duplicates ${kind} ${JSON.stringify(value)}.`);
      else seen.set(value, index);
    }

    if (fileContents instanceof Map && isSafeRelativePath(ticket.file)) {
      const contents = fileContents.get(ticket.file);
      if (typeof contents !== "string" || contents.trim() === "")
        errors.push(`${label} document is missing or empty: ${ticket.file}.`);
    }
  }

  for (const [index, ticket] of catalog.entries()) {
    if (
      !ticket ||
      typeof ticket !== "object" ||
      !Array.isArray(ticket.depends_on)
    )
      continue;
    for (const dependency of ticket.depends_on) {
      if (dependency === ticket.id)
        errors.push(`Ticket ${ticket.id} depends on itself.`);
      else if (!ids.has(dependency))
        errors.push(
          `Ticket ${ticket.id} depends on missing ticket ${dependency}.`,
        );
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle includes ticket ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    const ticket = catalog[ids.get(id)];
    if (!ticket || !Array.isArray(ticket.depends_on)) return;
    visiting.add(id);
    for (const dependency of ticket.depends_on)
      if (ids.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids.keys()) visit(id);
  return errors;
}

async function loadCatalog(rootDir) {
  const manifestFile = path.join(rootDir, "docs/tickets/index.json");
  let catalog;
  try {
    catalog = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${manifestFile}: ${error.message}`);
  }
  const schemaErrors = validateCatalog(catalog);
  if (schemaErrors.length) return { catalog, errors: schemaErrors };

  const fileContents = new Map();
  for (const ticket of catalog) {
    try {
      fileContents.set(
        ticket.file,
        await readFile(path.join(rootDir, ticket.file), "utf8"),
      );
    } catch {
      // validateCatalog reports absent documents in one consistent format.
    }
  }
  return { catalog, errors: validateCatalog(catalog, { fileContents }) };
}

async function main(argv) {
  const [command, argument, ...rest] = argv;
  if (
    (command !== "check" && command !== "show") ||
    rest.length > 0 ||
    (command === "check" && argument !== undefined) ||
    (command === "show" && !/^[1-9][0-9]*$/.test(argument ?? ""))
  ) {
    throw new Error(
      "Usage: node scripts/tickets.mjs check | show <positive ticket id>",
    );
  }
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const { catalog, errors } = await loadCatalog(rootDir);
  if (errors.length)
    throw new Error(
      `Ticket catalog is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  if (command === "check") return;

  const id = Number(argument);
  const ticket = catalog.find((item) => item.id === id);
  if (!ticket) throw new Error(`Ticket ${id} was not found.`);
  const dependencies = ticket.depends_on.map((dependency) =>
    catalog.find((item) => item.id === dependency),
  );
  const contents = await readFile(path.join(rootDir, ticket.file), "utf8");
  process.stdout.write(
    `${JSON.stringify({ ticket, dependencies, branch: `feat/ticket-${String(id).padStart(3, "0")}-${ticket.slug}`, contents }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
