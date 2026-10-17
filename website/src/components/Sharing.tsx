const GATES = [
  { title: 'One folder', text: 'Not its neighbours, not its sub-folders.' },
  { title: 'A password, if you want one', text: 'Wrong guesses get slowed down.' },
  { title: 'An end date', text: 'The link stops working on its own.' },
  { title: 'Originals stay home', text: 'Guests see the photos, not the files, unless you allow downloads.' },
]

interface Row {
  name: string
  depth: number
  state: 'shared' | 'photo' | 'excluded' | 'other'
}

// Real folders and files of the demo library (demo/photos.json)
const TREE: Row[] = [
  { name: 'family-photos/', depth: 0, state: 'other' },
  { name: '2018-08 Iceland/', depth: 1, state: 'other' },
  { name: '2019-07 Lisbon/', depth: 1, state: 'other' },
  { name: '2021-09 Italy/', depth: 1, state: 'shared' },
  { name: 'IMG_2276.jpg', depth: 2, state: 'photo' },
  { name: 'IMG_2321.jpg', depth: 2, state: 'photo' },
  { name: 'Rome/', depth: 2, state: 'excluded' },
  { name: 'Tuscany/', depth: 2, state: 'excluded' },
  { name: '2021-12 Christmas at home/', depth: 1, state: 'other' },
  { name: '2023-05 Dolomites/', depth: 1, state: 'other' },
]

function TreeRow({ row }: { row: Row }) {
  const tone =
    row.state === 'shared'
      ? 'bg-paper text-ink font-medium ring-1 ring-ink'
      : row.state === 'photo'
        ? 'text-ink-soft'
        : row.state === 'excluded'
          ? 'text-ink-faint line-through decoration-ink-faint/60'
          : 'text-ink-faint'
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-md px-3 py-1.5 font-mono text-[0.8125rem] ${tone}`}
      style={{ marginLeft: `${row.depth * 1.25}rem` }}
    >
      <span className="truncate">{row.name}</span>
      {row.state === 'shared' && <span className="shrink-0 font-sans text-[0.6875rem] font-semibold uppercase tracking-wider">Link</span>}
      {row.state === 'excluded' && <span className="shrink-0 font-sans text-[0.6875rem] no-underline">not included</span>}
    </li>
  )
}

export function Sharing() {
  return (
    <section className="bg-sunken" aria-labelledby="sharing-title">
      <div className="mx-auto max-w-page px-5 py-24 sm:px-8 lg:py-32">
        <div className="max-w-prose">
          <p className="kicker">Sharing</p>
          <h2 id="sharing-title" className="mt-4 text-balance text-h2 font-semibold">
            Share a weekend, not your life.
          </h2>
          <p className="mt-5 text-lead text-ink-soft">A link opens one folder and nothing around it. You choose the rest.</p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          <figure className="min-w-0 lg:col-span-6">
            <ul className="space-y-0.5 rounded-xl border border-line bg-paper/60 p-3">
              {TREE.map((row) => (
                <TreeRow key={`${row.depth}-${row.name}`} row={row} />
              ))}
            </ul>
            <figcaption className="mt-3 text-sm text-ink-muted">
              A link to <span className="font-mono text-[0.8125rem]">2021-09 Italy</span> shows its two photos. Rome and
              Tuscany stay private.
            </figcaption>
          </figure>

          <ol className="relative lg:col-span-6" aria-label="What a guest goes through">
            <span aria-hidden className="absolute bottom-3 left-[0.4375rem] top-3 w-px bg-line-strong" />
            {GATES.map((gate) => (
              <li key={gate.title} className="relative pb-8 pl-9 last:pb-0">
                <span aria-hidden className="absolute left-0 top-1.5 h-[0.9375rem] w-[0.9375rem] rounded-full border-2 border-ink bg-paper" />
                <p className="text-lg font-semibold">{gate.title}</p>
                <p className="mt-1 text-ink-soft">{gate.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-16 max-w-[44rem] border-t border-line-strong pt-8 text-[1.0625rem] leading-relaxed text-ink-soft">
          Behind the links, the library is yours alone. Only the email addresses you list can sign in. Blaze never rewrites
          your files: turning a photo is remembered, not saved over it. No analytics, no tracking.
        </p>
      </div>
    </section>
  )
}
