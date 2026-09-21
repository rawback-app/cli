import { createProgram } from '../../cli.ts'
import { bootstrapConfig } from '../../config-init.ts'
import { CommandOutput } from '../../ui/output.tsx'
import { helpDocument } from './help.ts'

function normalizedArgs(args: string[]): string[] {
  if (args[0] !== 'upload') return args
  return args.filter((argument) => argument !== '--help' && argument !== '-h')
}

function isHelpRequest(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h')
}

function isVersionRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === '--version' || args[0] === '-V')
}

/**
 * `rawback config init` writes the same file itself and reports what it did, so
 * the implicit bootstrap must not get there first and turn it into a no-op.
 */
function isConfigInit(args: string[]): boolean {
  return args[0] === 'config' && args[1] === 'init'
}

/**
 * The command being run, without its arguments.
 *
 * Only the leading non-flag words: an option value can be a search term or a
 * path from the user's disk, and neither belongs in a log record.
 */
function commandName(args: string[]): string {
  const words: string[] = []
  for (const argument of args) {
    if (argument.startsWith('-')) break
    words.push(argument)
  }
  return words.join(' ') || '(none)'
}

export async function runCli(
  args: string[],
  version: string,
  output = new CommandOutput(),
): Promise<void> {
  const program = createProgram(version, output)

  if (args.length === 0) {
    output.document(helpDocument(await program.getHelp()))
    return
  }

  if (isVersionRequest(args)) {
    output.raw(version)
    return
  }

  const parseArgs = normalizedArgs(args)
  if (!isHelpRequest(parseArgs)) {
    // Creating the config here rather than in a yargs middleware is what keeps
    // `--help` and `--version` from writing to the user's home directory: both
    // return above, and every help request takes the branch below. The logger
    // is built lazily behind the same boundary, so neither path creates
    // `~/.rawback/logs/` either.
    if (!isConfigInit(parseArgs)) await bootstrapConfig(output)
    const { commandLogger, flushCommandLogger } = await import('../../logging.ts')
    const command = commandName(parseArgs)
    const logger = (await commandLogger()).child({ component: 'cli', command })
    const startedAt = performance.now()
    logger.debug({ event: 'cli.command.start' }, `running ${command}`)
    try {
      await program.parseAsync(parseArgs)
    } finally {
      // `runCommand` turns a failure into an exit code rather than a throw, so
      // the outcome is read from there rather than from a catch.
      const exitCode = process.exitCode ?? 0
      const failed = exitCode !== 0
      logger[failed ? 'warn' : 'debug'](
        {
          event: 'cli.command.done',
          exitCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        failed ? `${command} exited ${String(exitCode)}` : `${command} finished`,
      )
      // A failed command is exactly the one whose records need to reach the
      // file, and the rolling destination is asynchronous — without this the
      // process exits before it drains.
      await flushCommandLogger()
    }
    return
  }

  let help = ''
  await program.parseAsync(parseArgs, {}, (_error, _argv, rendered) => {
    help = rendered
  })
  if (help.trim().length > 0) {
    output.document(helpDocument(help))
  }
}
