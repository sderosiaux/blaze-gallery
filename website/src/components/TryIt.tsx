'use client'

import { useState } from 'react'
import { REPO } from '@/lib/asset'
import { GitHubMark } from './GitHubMark'

const COMMANDS = [
  'git clone https://github.com/sderosiaux/blaze-gallery.git',
  'cd blaze-gallery',
  'cp .env.demo .env',
  'docker compose --profile demo up -d --build',
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => {
            setCopied(false)
          }, 1600)
        })
      }}
      className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

export function TryIt() {
  return (
    <section id="try" className="mx-auto max-w-page scroll-mt-8 px-5 py-24 sm:px-8 lg:py-32" aria-labelledby="try-title">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="kicker">Try it</p>
          <h2 id="try-title" className="mt-4 text-balance text-h2 font-semibold">
            Try it on someone else&apos;s holidays first.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-ink-soft">
            The demo starts a complete Blaze on sixty free-licensed photos. Nothing to configure, only Docker.
          </p>
        </div>

        <div className="min-w-0 lg:col-span-7">
          <div className="overflow-hidden rounded-xl border border-line bg-sunken">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-mono text-xs text-ink-muted">Terminal</span>
              <CopyButton text={COMMANDS.join('\n')} />
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[0.8125rem] leading-7 text-ink">
              {COMMANDS.map((c) => (
                <span key={c} className="block">
                  <span aria-hidden className="select-none text-ink-faint">$ </span>
                  {c}
                </span>
              ))}
            </pre>
          </div>
          <p className="mt-4 text-ink-soft">
            Then open <span className="font-mono text-[0.9375rem] text-ink">localhost:3100</span>. The first start builds the image
            and downloads the photos.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href={`${REPO}/blob/main/docs/SETUP.md`}
              className="rounded-full bg-ink px-6 py-3 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-ink-soft"
            >
              Point it at your bucket
            </a>
            <a
              href={REPO}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[0.9375rem] font-medium transition-colors hover:bg-sunken"
            >
              <GitHubMark className="h-4 w-4" />
              Read the code
            </a>
          </div>
          <p className="mt-6 text-sm text-ink-muted">
            Works with Backblaze B2, Cloudflare R2, MinIO and other S3-compatible storage. The interface speaks French for
            now.
          </p>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-page flex-col gap-6 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tracking-tight">Blaze</span>
            <span className="text-sm text-ink-muted">Gallery</span>
          </p>
          <p className="mt-3 max-w-sm text-sm text-ink-muted">
            Made by someone with 200,000 photos and, until now, nowhere good to look at them.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
          <li>
            <a className="hover:text-ink" href={REPO}>
              GitHub
            </a>
          </li>
          <li>
            <a className="hover:text-ink" href={`${REPO}/blob/main/docs/SETUP.md`}>
              Setup guide
            </a>
          </li>
          <li>
            <a className="hover:text-ink" href={`${REPO}/blob/main/demo/CREDITS.md`}>
              Demo photos from Unsplash
            </a>
          </li>
          <li>
            <a className="hover:text-ink" href={`${REPO}/blob/main/LICENSE`}>
              MIT licence
            </a>
          </li>
        </ul>
      </div>
    </footer>
  )
}
