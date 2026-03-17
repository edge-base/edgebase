import { Command } from 'commander';
import { raiseCliError } from '../lib/agent-contract.js';

/**
 * `npx edgebase completion <shell>` — Generate shell completion scripts.
 *
 * Outputs a completion script for bash, zsh, or fish to stdout.
 * Users pipe the output to their shell config file:
 *
 *   edgebase completion bash >> ~/.bashrc
 *   edgebase completion zsh  >> ~/.zshrc
 *   edgebase completion fish > ~/.config/fish/completions/edgebase.fish
 */

const COMMANDS = [
  'init', 'dev', 'deploy', 'destroy', 'logs', 'upgrade',
  'migration', 'migrate', 'seed', 'backup', 'export', 'typegen', 'neon',
  'secret', 'keys', 'admin',
  'plugins', 'create-plugin', 'docker', 'webhook-test',
  'completion', 'describe', 'telemetry', 'realtime',
];

const GLOBAL_OPTIONS = ['--verbose', '--quiet', '--json', '--non-interactive', '--help', '--version'];

function bashCompletion(): string {
  return `# EdgeBase CLI bash completion
# Add to ~/.bashrc: eval "$(edgebase completion bash)"
_edgebase_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${COMMANDS.join(' ')}"
  local global_opts="${GLOBAL_OPTIONS.join(' ')}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${commands} \${global_opts}" -- "\${cur}") )
  elif [ "\${COMP_WORDS[1]}" = "backup" ] && [ "\${COMP_CWORD}" -eq 2 ]; then
    COMPREPLY=( $(compgen -W "create restore" -- "\${cur}") )
  elif [ "\${COMP_WORDS[1]}" = "migration" ] && [ "\${COMP_CWORD}" -eq 2 ]; then
    COMPREPLY=( $(compgen -W "create" -- "\${cur}") )
  elif [ "\${COMP_WORDS[1]}" = "telemetry" ] && [ "\${COMP_CWORD}" -eq 2 ]; then
    COMPREPLY=( $(compgen -W "enable disable status" -- "\${cur}") )
  elif [ "\${COMP_WORDS[1]}" = "completion" ] && [ "\${COMP_CWORD}" -eq 2 ]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
  fi
}
complete -F _edgebase_completions edgebase
`;
}

function zshCompletion(): string {
  return `#compdef edgebase
# EdgeBase CLI zsh completion
# Add to ~/.zshrc: eval "$(edgebase completion zsh)"

_edgebase() {
  local -a commands
  commands=(
${COMMANDS.map(c => `    '${c}:${getDescription(c)}'`).join('\n')}
  )

  _arguments -C \\
    '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \\
    '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]' \\
    '--json[Output results as JSON]' \\
    '--non-interactive[Disable prompts and return structured input or user-action requirements]' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
        backup)
          _values 'subcommand' 'create[Create a full backup]' 'restore[Restore from backup]'
          ;;
        migration)
          _values 'subcommand' 'create[Create migration]'
          ;;
        telemetry)
          _values 'subcommand' 'enable[Enable telemetry]' 'disable[Disable telemetry]' 'status[Show status]'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
      esac
      ;;
  esac
}

_edgebase
`;
}

function fishCompletion(): string {
  const lines = [
    '# EdgeBase CLI fish completion',
    '# Save to: ~/.config/fish/completions/edgebase.fish',
    '',
  ];

  for (const cmd of COMMANDS) {
    lines.push(
      `complete -c edgebase -n '__fish_use_subcommand' -a '${cmd}' -d '${getDescription(cmd)}'`,
    );
  }

  // Subcommands
  lines.push(`complete -c edgebase -n '__fish_seen_subcommand_from backup' -a 'create restore'`);
  lines.push(`complete -c edgebase -n '__fish_seen_subcommand_from migration' -a 'create'`);
  lines.push(`complete -c edgebase -n '__fish_seen_subcommand_from telemetry' -a 'enable disable status'`);
  lines.push(`complete -c edgebase -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'`);

  // Global options
  lines.push(`complete -c edgebase -l verbose -s v -d 'Show detailed output'`);
  lines.push(`complete -c edgebase -l quiet -s q -d 'Suppress non-essential output'`);
  lines.push(`complete -c edgebase -l json -d 'Output results as JSON'`);
  lines.push(`complete -c edgebase -l non-interactive -d 'Disable prompts and return structured input or user-action requirements'`);

  return lines.join('\n') + '\n';
}

function getDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    init: 'Create a new project',
    dev: 'Start local dev server',
    deploy: 'Deploy to Cloudflare',
    destroy: 'Destroy Cloudflare resources for this project',
    logs: 'View server logs',
    upgrade: 'Upgrade EdgeBase packages',
    migration: 'Schema migration management',
    migrate: 'Migrate data between providers',
    seed: 'Seed database with data',
    backup: 'Backup and restore',
    export: 'Export table data',
    typegen: 'Generate TypeScript types',
    neon: 'Configure Neon PostgreSQL',
    secret: 'Manage secrets',
    keys: 'Manage Service Keys',
    admin: 'Admin account management',
    plugins: 'Plugin management',
    'create-plugin': 'Scaffold a new plugin',
    docker: 'Docker deployment',
    'webhook-test': 'Test webhook events',
    completion: 'Generate shell completion',
    describe: 'Describe the CLI surface',
    telemetry: 'Manage telemetry',
    realtime: 'Provision Cloudflare Realtime resources',
  };
  return descriptions[cmd] ?? cmd;
}

export const completionCommand = new Command('completion')
  .description('Generate shell completion script')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .addHelpText('after', `
Examples:
  edgebase completion bash >> ~/.bashrc
  edgebase completion zsh  >> ~/.zshrc
  edgebase completion fish > ~/.config/fish/completions/edgebase.fish`)
  .action((shell: string) => {
    switch (shell.toLowerCase()) {
      case 'bash':
        process.stdout.write(bashCompletion());
        break;
      case 'zsh':
        process.stdout.write(zshCompletion());
        break;
      case 'fish':
        process.stdout.write(fishCompletion());
        break;
      default:
        raiseCliError({
          code: 'completion_shell_unsupported',
          field: 'shell',
          message: `Unsupported shell: ${shell}. Use bash, zsh, or fish.`,
        });
    }
  });
