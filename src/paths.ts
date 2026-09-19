import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Expands a leading `~` to the user's home directory. Shells only do this when
 * the word itself starts with `~`, so `--path=~/Pictures` reaches the CLI
 * unexpanded and would otherwise resolve as a directory named `~` under cwd.
 * `~user` forms and the `-` stdin/stdout sentinel are returned unchanged.
 */
export function expandHomePath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) {
    return join(homedir(), value.slice(2))
  }
  return value
}
