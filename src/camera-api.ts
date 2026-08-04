import { CameraError } from './camera-errors.ts'
import {
  describeParams,
  findEntry,
  listEntries,
  parseArgs,
  type ApiEntry,
} from './camera-registry.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import { apiCatalogDocument, apiResultDocument } from './features/camera/view.ts'

export interface CameraApiOptions extends CameraTargetOptions {
  id?: string
  list?: boolean
  describe?: boolean
  namespace?: string
  mutating?: boolean
  arg?: string[]
  force?: boolean
}

function serializeEntry(entry: ApiEntry) {
  return {
    id: entry.id,
    namespace: entry.namespace,
    label: entry.label,
    doc: entry.doc,
    method: entry.method,
    mutates: entry.mutates,
    unreliable: entry.unreliable ?? false,
    params: entry.params.map((param) => ({
      name: param.name,
      kind: param.kind,
      required: param.required,
      options: param.kind === 'enum' ? [...param.options] : null,
    })),
  }
}

export async function runCameraApi(
  options: CameraApiOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.list === true) {
    const entries = listEntries({
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.mutating !== undefined ? { mutating: options.mutating } : {}),
    })
    if (options.json === true) {
      ui.json({ count: entries.length, endpoints: entries.map(serializeEntry) })
      return
    }
    ui.document(
      apiCatalogDocument(
        entries.map((entry) => ({
          id: entry.id,
          namespace: entry.namespace,
          method: entry.method,
          doc: entry.doc,
          params: describeParams(entry),
          mutates: entry.mutates,
          unreliable: entry.unreliable ?? false,
        })),
      ),
    )
    return
  }

  if (options.id === undefined) {
    throw new CameraError('rawback camera api needs an endpoint ID, or --list')
  }

  // Registry lookup and argument coercion happen before any session is built,
  // so a typo fails without touching the camera.
  const entry = findEntry(options.id)
  const args = parseArgs(entry, options.arg ?? [])

  if (options.describe === true) {
    if (options.json === true) {
      ui.json(serializeEntry(entry))
      return
    }
    ui.document(apiResultDocument(entry, undefined))
    return
  }

  if (entry.unreliable === true) {
    ui.warning(`${entry.id} is documented to misbehave on real hardware.`)
  }

  if (entry.mutates && options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `${entry.id} changes the camera. Run it?`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ id: entry.id, ran: false })
      else ui.info('Did not run it.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    if (entry.suffix !== undefined && !session.supports(entry.suffix)) {
      throw new CameraError(
        `This camera does not advertise "${entry.suffix}", which ${entry.id} needs. ` +
          'Run rawback camera api --list to see what it supports.',
      )
    }

    const started = Date.now()
    const result = await entry.run(session, args)
    const ms = Date.now() - started

    if (options.json === true) {
      ui.json({ id: entry.id, args, ms, result: result ?? null })
      return
    }
    ui.document(apiResultDocument(entry, { result, ms }))
  })
}
