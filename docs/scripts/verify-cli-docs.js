/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const docsRoot = path.join(__dirname, '..');
const repoRoot = path.join(docsRoot, '..');

const cliIndexPath = path.join(repoRoot, 'packages', 'cli', 'src', 'index.ts');
const commandsDir = path.join(repoRoot, 'packages', 'cli', 'src', 'commands');
const overviewPath = path.join(docsRoot, 'docs', 'cli', 'overview.md');
const referencePath = path.join(docsRoot, 'docs', 'cli', 'reference.md');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractRegisteredCommands() {
  const indexSource = read(cliIndexPath);
  const importMap = new Map();
  const importRegex = /import \{ (\w+) \} from '\.\/commands\/([^']+)\.js';/g;

  for (const match of indexSource.matchAll(importRegex)) {
    importMap.set(match[1], match[2]);
  }

  const commands = [];
  const addCommandRegex = /program\.addCommand\((\w+)\);/g;
  for (const match of indexSource.matchAll(addCommandRegex)) {
    const variableName = match[1];
    const commandName = importMap.get(variableName);
    assert(commandName, `Could not resolve imported command for ${variableName}`);
    commands.push(commandName);
  }

  return commands;
}

function extractReferenceSections(referenceSource) {
  const sections = new Map();
  const headingRegex = /^### `([^`]+)`\s*$/gm;
  const headings = [...referenceSource.matchAll(headingRegex)];

  headings.forEach((match, index) => {
    const name = match[1];
    const start = match.index + match[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : referenceSource.length;
    sections.set(name, referenceSource.slice(start, end));
  });

  return sections;
}

function extractSubcommands(commandName) {
  const commandSource = read(path.join(commandsDir, `${commandName}.ts`));
  const subcommands = [];
  const subcommandRegex = /\.command\('([^']+)'\)/g;

  for (const match of commandSource.matchAll(subcommandRegex)) {
    const definition = match[1].trim();
    const subcommand = definition.split(/[ <[]/)[0];
    if (subcommand) {
      subcommands.push(subcommand);
    }
  }

  return Array.from(new Set(subcommands));
}

function verifyCliDocs() {
  const commands = extractRegisteredCommands();
  const overviewSource = read(overviewPath);
  const referenceSource = read(referencePath);
  const referenceSections = extractReferenceSections(referenceSource);

  commands.forEach((commandName) => {
    assert(
      overviewSource.includes(`\`${commandName}\``),
      `CLI overview is missing command \`${commandName}\``
    );

    assert(
      referenceSections.has(commandName),
      `CLI reference is missing section for command \`${commandName}\``
    );

    const section = referenceSections.get(commandName);
    const subcommands = extractSubcommands(commandName);
    subcommands.forEach((subcommand) => {
      assert(
        section.includes(`edgebase ${commandName} ${subcommand}`),
        `CLI reference section \`${commandName}\` is missing an example for subcommand \`${subcommand}\``
      );
    });
  });
}

try {
  verifyCliDocs();
  console.log('verify-cli-docs: OK');
} catch (error) {
  console.error(`verify-cli-docs: ${error.message}`);
  process.exit(1);
}
