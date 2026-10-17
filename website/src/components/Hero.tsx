'use client'

import { useEffect, useRef, useState } from 'react'
import photos from '@/content/christmas.json'
import { REPO, asset } from '@/lib/asset'
import { GitHubMark } from './GitHubMark'

type View = 'bucket' | 'album'

const FOLDER = '2021-12 Christmas at home'

function rows<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))
}

function takenLabel(iso: string) {
  return iso.slice(0, 16).replace('T', ' ')
}

/** The same folder twice: as the bucket lists it, then as Blaze shows it. */
function Transformation() {
  const [view, setView] = useState<View>('bucket')
  const touched = useRef(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setView('album')
      return
    }
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || touched.current) return
        observer.disconnect()
        timer = window.setTimeout(() => {
          if (!touched.current) setView('album')
        }, 1100)
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  const choose = (next: View) => {
    touched.current = true
    setView(next)
  }

  const album = view === 'album'

  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-line bg-paper shadow-frame">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <p className="min-w-0 truncate font-mono text-xs text-ink-muted" aria-live="polite">
          {album ? (
            <span className="font-sans text-[0.8125rem] text-ink-soft">Bibliothèque › Christmas at home</span>
          ) : (
            <>
              family-photos / <span className="text-ink-soft">{FOLDER}</span> /
            </>
          )}
        </p>
        <div role="group" aria-label="Show this folder" className="flex shrink-0 rounded-full bg-sunken p-0.5 text-xs font-medium">
          {(['bucket', 'album'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                choose(v)
              }}
              className={`rounded-full px-3 py-1.5 transition-colors duration-200 ${
                view === v ? 'bg-paper text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {v === 'bucket' ? 'In your bucket' : 'In Blaze'}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-[33rem] sm:min-h-[28rem] lg:min-h-[30rem]">
        {/* The bucket: what a storage console shows you */}
        <table
          aria-hidden={album}
          className={`absolute inset-x-0 top-0 w-full text-left font-mono text-[0.8125rem] transition-opacity duration-300 ${album ? 'pointer-events-none' : ''}`}
          // Row borders ignore the rows' own opacity: the whole table leaves once they have
          style={{ opacity: album ? 0 : 1, transitionDelay: album ? '420ms' : '0ms' }}
        >
          <thead>
            <tr
              className={`text-[0.6875rem] uppercase tracking-wider text-ink-faint transition-opacity duration-300 ${album ? 'opacity-0' : 'opacity-100'}`}
            >
              <th className="px-5 py-3 font-normal">Name</th>
              <th className="hidden px-5 py-3 font-normal sm:table-cell">Type</th>
              <th className="px-5 py-3 text-right font-normal">Last modified</th>
            </tr>
          </thead>
          <tbody>
            {photos.map((p, i) => (
              <tr
                key={p.file}
                className="border-t border-line/70 transition-all duration-500 ease-out-soft"
                style={{
                  opacity: album ? 0 : 1,
                  transform: album ? 'translateY(-8px)' : 'none',
                  transitionDelay: `${album ? i * 35 : 200 + i * 25}ms`,
                }}
              >
                <td className="px-5 py-3 text-ink-soft">{p.file}</td>
                <td className="hidden px-5 py-3 text-ink-faint sm:table-cell">image/jpeg</td>
                <td className="px-5 py-3 text-right text-ink-faint">{takenLabel(p.taken)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Blaze: the same eight files, as the app lays them out */}
        <div aria-hidden={!album} className={`absolute inset-0 px-4 pb-5 pt-6 sm:px-6 ${album ? '' : 'pointer-events-none'}`}>
          <div
            className="transition-all duration-500 ease-out-soft"
            style={{ opacity: album ? 1 : 0, transform: album ? 'none' : 'translateY(6px)', transitionDelay: album ? '150ms' : '0ms' }}
          >
            <p className="kicker">Décembre 2021</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-[2rem]">Christmas at home</p>
            <p className="mt-1 text-sm text-ink-muted">8 photos</p>
          </div>
          {[4, 2].map((size) => (
            <div key={size} className={`mt-5 flex-col gap-1 ${size === 4 ? 'hidden sm:flex' : 'flex sm:hidden'}`}>
              {rows(
                photos.map((p, i) => ({ ...p, i })),
                size,
              ).map((row, r) => (
                <div key={r} className="flex gap-1">
                  {row.map((p) => {
                    const ratio = p.width / p.height
                    return (
                      <div
                        key={p.file}
                        className="relative overflow-hidden rounded-[3px] bg-sunken transition-opacity duration-300"
                        // The tile leaves with its photo: its grey placeholder must not sit over the listing
                        style={{
                          flexGrow: ratio,
                          flexBasis: 0,
                          aspectRatio: `${ratio}`,
                          opacity: album ? 1 : 0,
                          transitionDelay: album ? `${200 + p.i * 70}ms` : '0ms',
                        }}
                      >
                        <img
                          src={asset(p.src)}
                          alt=""
                          width={p.width}
                          height={p.height}
                          decoding="async"
                          className="h-full w-full object-cover transition-all duration-700 ease-out-soft"
                          style={{
                            opacity: album ? 1 : 0,
                            transform: album ? 'none' : 'scale(1.04)',
                            filter: album ? 'none' : 'blur(8px)',
                            transitionDelay: album ? `${250 + p.i * 70}ms` : '0ms',
                          }}
                        />
                        <span
                          className={`absolute bottom-1.5 left-2 rounded bg-paper/85 px-1.5 py-0.5 font-mono text-[0.625rem] text-ink-soft ${
                            album ? 'animate-[name-fade_2.6s_ease-out_forwards]' : 'opacity-0'
                          }`}
                          style={{ animationDelay: album ? `${250 + p.i * 70}ms` : undefined }}
                        >
                          {p.file}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  return (
    <header className="mx-auto max-w-page px-5 pb-20 pt-6 sm:px-8 sm:pt-8 lg:pb-28">
      <nav className="flex items-center justify-between" aria-label="Blaze Gallery">
        <a href={asset('')} className="flex items-baseline gap-1.5 rounded-sm">
          <span className="text-xl font-semibold tracking-tight">Blaze</span>
          <span className="text-sm text-ink-muted">Gallery</span>
        </a>
        <div className="flex items-center gap-1 text-sm">
          <a href={`${REPO}/blob/main/docs/SETUP.md`} className="rounded-full px-3 py-2 text-ink-soft transition-colors hover:text-ink">
            Setup
          </a>
          <a
            href={REPO}
            className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 font-medium transition-colors hover:border-line-strong"
          >
            <GitHubMark className="h-4 w-4" />
            GitHub
          </a>
        </div>
      </nav>

      <div className="mt-14 sm:mt-20">
        <p className="kicker">Open source, self-hosted</p>
        <h1 className="mt-5 text-display font-semibold">
          You backed up every photo.
          <br className="hidden md:block" /> Now look at them.
        </h1>
        <div className="mt-7 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-[34rem] text-lead text-ink-soft">
            Blaze turns the photos already sitting in your Backblaze, S3 or R2 bucket into a private gallery you&apos;ll
            actually open. Nothing to import, nothing moves.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <a
              href="#try"
              className="rounded-full bg-ink px-6 py-3 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-ink-soft"
            >
              Try the demo
            </a>
            <a
              href={REPO}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-sunken"
            >
              <GitHubMark className="h-4 w-4" />
              View on GitHub
            </a>
          </div>
        </div>
      </div>

      <figure className="mt-12">
        <Transformation />
        <figcaption className="mt-3 text-sm text-ink-muted">
          Same eight files. Switch between how your storage lists them and how Blaze shows them.
        </figcaption>
      </figure>
    </header>
  )
}
