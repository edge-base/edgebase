import { Argument, Command, Option } from 'commander';
import { raiseCliError } from '../lib/agent-contract.js';
import { isJson } from '../lib/cli-context.js';

interface SerializedArgument {
  name: string;
  syntax: string;
  description: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
}

interface SerializedOption {
  flags: string;
  description: string;
  short?: string;
  long?: string;
  required: boolean;
  optional: boolean;
  variadic: boolean;
  mandatory: boolean;
  negate: boolean;
  defaultValue?: unknown;
  choices?: string[];
}

interface SerializedCommand {
  path: string;
  name: string;
  aliases: string[];
  description: string;
  summary: string;
  arguments: SerializedArgument[];
  options: SerializedOption[];
  subcommands: SerializedCommand[];
}

interface SerializedCli {
  name: string;
  version: string;
  description: string;
  globalOptions: SerializedOption[];
  commands: SerializedCommand[];
}

function serializeArgument(argument: Argument): SerializedArgument {
  const argWithDescription = argument as Argument & { description?: string };
  const name = argument.name();
  const variadicSuffix = argument.variadic ? '...' : '';
  return {
    name,
    syntax: argument.required ? `<${name}${variadicSuffix}>` : `[${name}${variadicSuffix}]`,
    description: argWithDescription.description ?? '',
    required: argument.required,
    variadic: argument.variadic,
    ...(argument.defaultValue !== undefined ? { defaultValue: argument.defaultValue } : {}),
  };
}

function serializeOption(option: Option): SerializedOption {
  const optionWithChoices = option as Option & { argChoices?: string[] };
  return {
    flags: option.flags,
    description: option.description ?? '',
    ...(option.short ? { short: option.short } : {}),
    ...(option.long ? { long: option.long } : {}),
    required: option.required,
    optional: option.optional,
    variadic: option.variadic,
    mandatory: option.mandatory,
    negate: option.negate,
    ...(option.defaultValue !== undefined ? { defaultValue: option.defaultValue } : {}),
    ...(optionWithChoices.argChoices && optionWithChoices.argChoices.length > 0
      ? { choices: optionWithChoices.argChoices }
      : {}),
  };
}

function isHiddenCommand(command: Command): boolean {
  return !!((command as Command & { _hidden?: boolean })._hidden);
}

export function serializeCommand(command: Command, path = command.name()): SerializedCommand {
  return {
    path,
    name: command.name(),
    aliases: command.aliases(),
    description: command.description(),
    summary: command.summary(),
    arguments: command.registeredArguments.map(serializeArgument),
    options: command.options.map(serializeOption),
    subcommands: command.commands
      .filter((subcommand) => !isHiddenCommand(subcommand))
      .map((subcommand) => serializeCommand(subcommand, `${path} ${subcommand.name()}`)),
  };
}

export function serializeCli(root: Command): SerializedCli {
  return {
    name: root.name(),
    version: root.version() ?? '',
    description: root.description(),
    globalOptions: root.options.map(serializeOption),
    commands: root.commands
      .filter((command) => !isHiddenCommand(command))
      .map((command) => serializeCommand(command, command.name())),
  };
}

export function findCommandByPath(root: Command, rawPath: string): Command | null {
  const tokens = rawPath
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return root;

  const normalizedTokens = tokens[0] === root.name() ? tokens.slice(1) : tokens;
  let current: Command = root;

  for (const token of normalizedTokens) {
    const next = current.commands.find(
      (candidate) => !isHiddenCommand(candidate)
        && (candidate.name() === token || candidate.aliases().includes(token)),
    );
    if (!next) return null;
    current = next;
  }

  return current;
}

export const describeCommand = new Command('describe')
  .description('Describe the CLI surface in a machine-readable format')
  .option('--command <path>', 'Limit the output to one command path, for example "backup restore"')
  .addHelpText('after', `
Examples:
  edgebase --json describe
  edgebase --json describe --command "backup restore"
  edgebase --json describe --command deploy`)
  .action((options: { command?: string }, command: Command) => {
    const root = command.parent ?? command;

    if (options.command) {
      const target = findCommandByPath(root, options.command);
      if (!target) {
        raiseCliError({
          code: 'describe_command_not_found',
          field: 'command',
          message: `Unknown command path: ${options.command}`,
          hint: 'Run `edgebase --json describe` to inspect the available command tree.',
        });
      }

      const payload = {
        status: 'success' as const,
        command: serializeCommand(target, target === root ? root.name() : options.command.trim()),
      };
      console.log(JSON.stringify(payload, null, isJson() ? undefined : 2));
      return;
    }

    const payload = {
      status: 'success' as const,
      cli: serializeCli(root),
    };
    console.log(JSON.stringify(payload, null, isJson() ? undefined : 2));
  });
