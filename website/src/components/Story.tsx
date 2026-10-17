import { asset } from '@/lib/asset'

const SIZES = { library: [1800, 1085], timeline: [1800, 1190], viewer: [1800, 1256] } as const

function Shot({ name, alt, className = '' }: { name: keyof typeof SIZES; alt: string; className?: string }) {
  const [width, height] = SIZES[name]
  return (
    <img
      src={asset(`shots/${name}.webp`)}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={`w-full rounded-lg border border-line bg-sunken shadow-frame ${className}`}
    />
  )
}

function Text({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="kicker">{kicker}</p>
      <h2 className="mt-4 text-balance text-h2 font-semibold">{title}</h2>
      <div className="mt-5 space-y-4 text-[1.0625rem] leading-relaxed text-ink-soft">{children}</div>
    </div>
  )
}

/** A folder name as it sits in the bucket, and what Blaze makes of it. */
function NameToAlbum() {
  return (
    <div className="mt-8 flex items-center gap-4 text-sm" aria-label="2019-07 Lisbon becomes Lisbon, July 2019">
      <span className="rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[0.8125rem] text-ink-soft">2019-07 Lisbon/</span>
      <span aria-hidden className="text-ink-faint">
        →
      </span>
      <span>
        <span className="kicker block text-[0.625rem]">Juillet 2019</span>
        <span className="block text-lg font-semibold leading-tight">Lisbon</span>
      </span>
    </div>
  )
}

export function Story() {
  return (
    <main>
      <section className="mx-auto grid max-w-page grid-cols-1 items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:py-28">
        <div className="lg:col-span-5">
          <Text kicker="Your folders" title="The way you sorted them is already an album.">
            <p>
              Blaze reads your bucket as it is. A folder called <span className="font-mono text-[0.9375rem]">2019-07 Lisbon</span>{' '}
              becomes Lisbon, July 2019, with one of its photos on the cover. You don&apos;t tag anything or upload anything
              again.
            </p>
          </Text>
          <NameToAlbum />
        </div>
        <div className="lg:col-span-7 xl:-mr-16">
          <Shot name="library" alt="The Blaze library: twelve folders shown as albums with a cover photo, a date and a title" />
        </div>
      </section>

      <section className="mx-auto grid max-w-page grid-cols-1 items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:py-28">
        <div className="order-2 lg:order-1 lg:col-span-7 xl:-ml-16">
          <Shot name="timeline" alt="The Blaze timeline: May 2023 photos of the Dolomites, with a margin listing the years" />
        </div>
        <div className="order-1 lg:order-2 lg:col-span-5">
          <Text kicker="Your years" title="Walk back through the years.">
            <p>Every dated photo lands in its month. Pick a year in the margin and you&apos;re back in that summer.</p>
          </Text>
        </div>
      </section>

      <section className="mx-auto max-w-page px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-prose">
          <Text kicker="Your big trips" title="A trip of two thousand photos opens like ten.">
            <p>
              What&apos;s on screen loads first, the rest follows in order. RAW files show the picture your camera stored
              inside them. Open a photo and the next one is already waiting.
            </p>
          </Text>
        </div>
        <Shot
          name="viewer"
          alt="A photo of the Dolomites open in the Blaze viewer, on a white page, with its date underneath"
          className="mx-auto mt-12 max-w-5xl"
        />
      </section>
    </main>
  )
}
