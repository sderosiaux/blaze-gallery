"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Plus, UserRound, UserX } from "lucide-react";
import type { PersonSummary, PhotoFace } from "@/lib/people";
import { Button, Input } from "@/components/ui";
import { asArray, asString, readJsonObject } from "@/hooks/apiJson";
import { cn } from "@/lib/cn";

interface FacePopoverProps {
  face: PhotoFace;
  anchor: DOMRect;
  onClose: () => void;
  /** After a name was given or taken back: what to tell the owner. */
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

const WIDTH = 272;
const GAP = 8;
/** Height of the name tag under a named face, plus the gap. */
const NAME_TAG = 34;
const SHOWN = 6;

let peopleCache: PersonSummary[] | null = null;

async function loadPeople(): Promise<PersonSummary[]> {
  if (peopleCache) return peopleCache;
  const response = await fetch("/api/people");
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new Error(`HTTP ${response.status}`);
  peopleCache = asArray(data.people) as PersonSummary[];
  return peopleCache;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

async function post(faceId: number, body: Record<string, unknown>) {
  const response = await fetch(`/api/faces/${String(faceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
}

/**
 * Who is this face: a name to give (someone already known, or a new one),
 * or, when it has one, "Pas cette personne". Sits next to the face.
 */
export default function FacePopover({
  face,
  anchor,
  onClose,
  onChanged,
  onError,
}: FacePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const named = face.person;
  const [naming, setNaming] = useState(!named);
  const [text, setText] = useState("");
  const [people, setPeople] = useState<PersonSummary[]>(peopleCache ?? []);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: anchor.left,
    top: anchor.bottom + GAP,
  });

  useEffect(() => {
    loadPeople()
      .then(setPeople)
      .catch(() => {
        // Naming still works by typing: an unknown name creates the person
      });
  }, []);

  // Below the face when it fits, above otherwise; always inside the window
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.min(
      Math.max(GAP, anchor.left + anchor.width / 2 - WIDTH / 2),
      window.innerWidth - WIDTH - GAP,
    );
    // A named face has its name under the box: leave it readable
    const below = anchor.bottom + (named ? NAME_TAG : GAP);
    const top =
      below + height <= window.innerHeight - GAP
        ? below
        : Math.max(GAP, anchor.top - GAP - height);
    setPosition({ left, top });
  }, [anchor, named, naming, people.length, text]);

  // The field when naming; otherwise the popover itself, Tab reaches its buttons
  useEffect(() => {
    if (naming) inputRef.current?.focus();
    else ref.current?.focus();
  }, [naming]);

  // A click outside closes, like Escape
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target))
        onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const query = fold(text);
  // Exact name first, then names starting with what is typed
  const rank = (name: string) =>
    fold(name) === query ? 0 : fold(name).startsWith(query) ? 1 : 2;
  const matches = people
    .filter((p) => p.name && p.id !== named?.id)
    .filter((p) => !query || fold(p.name ?? "").includes(query))
    .sort((a, b) => rank(a.name ?? "") - rank(b.name ?? ""))
    .slice(0, SHOWN);
  const exact = people.some((p) => p.name && fold(p.name) === query);
  const typed = text.trim().replace(/\s+/g, " ");

  const run = async (
    body: Record<string, unknown>,
    message: string,
    failed: string,
  ) => {
    setBusy(true);
    try {
      await post(face.face_id, body);
      if (body.action === "name" && "name" in body) peopleCache = null;
      onChanged(message);
    } catch {
      onError(failed);
      setBusy(false);
    }
  };

  const give = (person: { id: number; name: string | null } | string) =>
    typeof person === "string"
      ? run(
          { action: "name", name: person },
          `Visage nommé ${person}`,
          "Le nom n’a pas été enregistré",
        )
      : run(
          { action: "name", person_id: person.id },
          `Visage nommé ${person.name ?? ""}`,
          "Le nom n’a pas été enregistré",
        );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed z-20 animate-rise-in rounded-lg border border-line bg-surface p-3 text-ink shadow-pop outline-none"
      style={{ width: WIDTH, left: position.left, top: position.top }}
    >
      {named && !naming ? (
        <>
          <p
            id={titleId}
            className="flex items-center gap-2 px-1 pb-3 text-sm font-semibold"
          >
            <UserRound className="h-4 w-4 text-ink-muted" aria-hidden />
            <span className="truncate">{named.name}</span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              icon={UserX}
              loading={busy}
              onClick={() =>
                void run(
                  { action: "unname" },
                  `Ce n’est pas ${named.name ?? "cette personne"}`,
                  "La correction n’a pas été enregistrée",
                )
              }
              className="hover:border-danger hover:text-danger"
            >
              Pas cette personne
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setNaming(true);
              }}
            >
              Changer
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            // Enter takes the first suggestion; a new name is created from its own button
            const first = matches[0];
            if (first) void give(first);
            else if (typed) void give(typed);
          }}
        >
          <label id={titleId} htmlFor={`${titleId}-name`} className="sr-only">
            Qui est-ce ?
          </label>
          <Input
            ref={inputRef}
            id={`${titleId}-name`}
            value={text}
            placeholder="Qui est-ce ?"
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          {(matches.length > 0 || (typed && !exact)) && (
            <ul className="mt-2 space-y-0.5">
              {matches.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void give(person)}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <UserRound
                      className="h-4 w-4 shrink-0 text-ink-muted"
                      aria-hidden
                    />
                    <span className="truncate">{person.name}</span>
                  </button>
                </li>
              ))}
              {typed && !exact && (
                <li>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void give(typed)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink transition-colors hover:bg-surface-sunken",
                    )}
                  >
                    <Plus
                      className="h-4 w-4 shrink-0 text-ink-muted"
                      aria-hidden
                    />
                    <span className="truncate">Créer « {typed} »</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </form>
      )}
    </div>
  );
}
