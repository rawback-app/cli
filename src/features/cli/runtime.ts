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
    // return above, and every help request takes the branch below.
    if (!isConfigInit(parseArgs)) await bootstrapConfig(output)
    await program.parseAsync(parseArgs)
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
