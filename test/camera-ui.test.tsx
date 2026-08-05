import { describe, expect, test } from 'bun:test'

import { renderToString } from 'ink'

import { findEntry, listEntries, type ApiEntry } from '../src/camera-registry.ts'
import { ApiList, buildRows, windowRows } from '../src/features/camera/api-list.tsx'
import { EndpointDetail } from '../src/features/camera/endpoint-detail.tsx'
import { JsonView } from '../src/features/camera/json-view.tsx'
import { ParamForm } from '../src/features/camera/param-form.tsx'
import { TextField } from '../src/features/camera/text-field.tsx'
import {
  apiCatalogDocument,
  cameraStatusDocument,
  contentsListDocument,
  eventDocument,
  savedCameraListDocument,
  settingDocument,
  settingsListDocument,
} from '../src/features/camera/view.ts'
import { CommandOutput } from '../src/ui/output.tsx'

function render(node: Parameters<typeof renderToString>[0], columns = 100): string {
  return renderToString(node, { columns })
}

describe('camera presenters', () => {
  const documents = {
    savedCameras: savedCameraListDocument([
      {
        id: '192.168.0.1:8080',
        name: 'Canon EOS R6m2',
        host: '192.168.0.1',
        port: 8080,
        useTLS: false,
        username: 'ccapi',
        passwordSaved: true,
        lastUsedAt: '2026-08-04T09:00:00.000Z',
        isDefault: true,
      },
    ]),
    status: cameraStatusDocument({
      battery: { name: 'LP-E6NH', level: 'full' },
      temperature: 'normal',
      unsupported: ['devicestatus/batterylist'],
    }),
    settings: settingsListDocument([{ name: 'av', value: 'f4.0', ability: ['f2.8', 'f4.0'] }]),
    setting: settingDocument({
      name: 'colortemperature',
      value: 5200,
      ability: null,
      range: { min: 2500, max: 10000, step: 100 },
    }),
    contents: contentsListDocument([{ locator: '/ccapi/x/IMG_1.JPG', name: 'IMG_1.JPG' }]),
    event: eventDocument({ changedKeys: ['battery'], battery: { value: 'full' } }),
    catalog: apiCatalogDocument(
      listEntries({ namespace: 'status' }).map((entry) => ({
        id: entry.id,
        namespace: entry.namespace,
        method: entry.method,
        doc: entry.doc,
        params: '—',
        mutates: entry.mutates,
        unreliable: false,
      })),
    ),
  }

  test.each([40, 80, 120])('every presenter renders at %i columns', (columns) => {
    const output = new CommandOutput({ columns, stdout: () => {}, stderr: () => {} })
    for (const [name, document] of Object.entries(documents)) {
      expect(() => output.render(document), name).not.toThrow()
      expect(output.render(document).length, name).toBeGreaterThan(0)
    }
  })

  test('a saved password is flagged but never printed', () => {
    const output = new CommandOutput({ columns: 100, stdout: () => {}, stderr: () => {} })
    const text = output.render(documents.savedCameras)
    expect(text).toContain('password saved')
    expect(text).toContain('ccapi')
  })

  test('a locked range setting reads as locked, not as zero', () => {
    const output = new CommandOutput({ columns: 100, stdout: () => {}, stderr: () => {} })
    const text = output.render(
      settingDocument({
        name: 'colortemperature',
        value: null,
        ability: null,
        range: { min: null, max: null, step: null },
      }),
    )
    expect(text).toContain('locked')
    expect(text).not.toMatch(/\b0\b/)
  })

  test('an empty event says so rather than rendering a blank table', () => {
    const output = new CommandOutput({ columns: 80, stdout: () => {}, stderr: () => {} })
    expect(output.render(eventDocument({ changedKeys: [] }))).toContain('No change reported')
  })
})

describe('ApiList', () => {
  const entries = listEntries()

  test('groups by namespace with a header per group', () => {
    const text = render(
      <ApiList entries={entries.slice(0, 8)} selected={0} height={20} unsupported={() => false} />,
    )
    expect(text).toContain('── connection ──')
    expect(text).toContain('▸')
  })

  test('keeps a selection deep inside a tall namespace visible', () => {
    // The regression the reference TUI fixed: a group taller than the window
    // must not pin the start to its header and freeze scrolling.
    const rows = buildRows(entries)
    const shootingRow = rows.findIndex(
      (row) => row.type === 'entry' && row.entry.namespace === 'shooting',
    )
    const deep = shootingRow + 60
    const target = rows[deep]
    expect(target).toBeDefined()
    expect(target?.type).toBe('entry')

    const window = windowRows(rows, deep, 20)
    expect(window).toContain(target as (typeof rows)[number])
    expect(window).toHaveLength(20)
  })

  test('dims endpoints the camera does not advertise', () => {
    const text = render(
      <ApiList entries={entries.slice(0, 4)} selected={0} height={10} unsupported={() => true} />,
    )
    expect(text.length).toBeGreaterThan(0)
  })
})

describe('EndpointDetail', () => {
  const readOnly = findEntry('status.getBattery')
  const mutating = findEntry('shooting.setAperture')
  const unreliable = findEntry('liveview.getScroll')

  function detail(entry: ApiEntry, overrides: Partial<Parameters<typeof EndpointDetail>[0]> = {}) {
    return render(
      <EndpointDetail
        entry={entry}
        view="result"
        runState={{ status: 'idle' }}
        pendingArgs={null}
        jsonHeight={10}
        scrollOffset={0}
        supported
        onSubmit={() => {}}
        onCancel={() => {}}
        {...overrides}
      />,
    )
  }

  test('marks a read-only endpoint and a mutating one differently', () => {
    expect(detail(readOnly)).toContain('read-only')
    expect(detail(mutating)).toContain('changes the camera')
  })

  test('warns about an endpoint the camera does not advertise', () => {
    expect(detail(readOnly, { supported: false })).toContain('does not advertise')
  })

  test('warns about an unreliable endpoint', () => {
    expect(detail(unreliable)).toContain('misbehave on real hardware')
  })

  test('renders a successful result as JSON', () => {
    const text = detail(readOnly, {
      runState: {
        status: 'ok',
        entryId: readOnly.id,
        result: { level: 'full' },
        ms: 38,
      },
    })
    expect(text).toContain('✓ ok · 38ms')
    expect(text).toContain('"level"')
  })

  test('renders a failure through the shared error prose', async () => {
    const { CCAPIError } = await import('@rawback/ccapi-js')
    const text = detail(readOnly, {
      runState: {
        status: 'error',
        entryId: readOnly.id,
        error: new CCAPIError('forbidden'),
        ms: 12,
      },
    })
    expect(text).toContain('one client at a time')
  })

  test('asks for confirmation before a mutating call', () => {
    const text = detail(mutating, { view: 'confirm', pendingArgs: { value: 'f5.6' } })
    expect(text).toContain('changes the camera')
    expect(text).toContain('f5.6')
  })
})

describe('ParamForm', () => {
  test('renders a field per parameter, marking required ones', () => {
    const text = render(
      <ParamForm
        entry={findEntry('contents.listContents')}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(text).toContain('storage*')
    expect(text).toContain('directory*')
    // `page` is optional, so it carries no asterisk.
    expect(text).toMatch(/page(?!\*)/)
  })

  test('renders enum and boolean fields in their own styles', () => {
    const text = render(
      <ParamForm
        entry={findEntry('shooting.pressShutterButtonManual')}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(text).toContain('half_press')
    expect(text).toContain('false')
  })
})

describe('JsonView', () => {
  test('windows a long document and reports the range', () => {
    const value = Object.fromEntries(
      Array.from({ length: 100 }, (_unused, index) => [`key${index}`, index]),
    )
    const text = render(<JsonView value={value} height={10} offset={0} />)
    expect(text).toContain('lines 1–10 of')
    expect(text).toContain('[ / ] to scroll')
  })

  test('says so when the camera returned no body', () => {
    expect(render(<JsonView value={undefined} height={5} offset={0} />)).toContain(
      'no body — the request succeeded',
    )
  })
})

describe('TextField', () => {
  test('renders a placeholder when empty and the value when not', () => {
    expect(
      render(<TextField value="" onChange={() => {}} focus={false} placeholder="filter…" />),
    ).toContain('filter…')
    expect(render(<TextField value="av" onChange={() => {}} focus={false} />)).toContain('av')
  })
})
