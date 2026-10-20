"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Mountain,
  Palette,
  PawPrint,
  Plus,
  Smile,
  Type,
  UserX,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import FaceThumb from "@/components/people/FaceThumb";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  COLOR_TONES,
  HUE_LABELS,
  HUES,
  TONE_LABELS,
  type ColorFilter,
} from "@/lib/colors";
import {
  EXPRESSION_LABELS,
  EXPRESSIONS,
  NO_URL_FILTER,
  type Expression,
  type UrlFilter,
} from "@/lib/photoFilter";
import type { TagGroup } from "@/lib/sceneTags";
import { removeParts, understandQuery } from "@/lib/searchQuery";
import { normalizeTextForSearch } from "@/lib/textUtils";
import { HUE_SWATCH } from "./ColorFilterBar";
import { filterChips, type FilterChip } from "./filterChips";
import { chipIcon, EXPRESSION_ICONS } from "./filterIcons";
import {
  useFilterVocabulary,
  type FilterVocabulary,
} from "./useFilterVocabulary";

type MenuEntry = "color" | "date";

interface FilterBarProps {
  filter: UrlFilter;
  onChange: (next: UrlFilter) => void;
  /** Entries the view offers its own way: the Couleurs grid's colors, the map's period */
  noMenu?: readonly MenuEntry[];
  /** Chips the view shows its own way (the Couleurs grid's color bar) */
  noChips?: readonly FilterChip["kind"][];
  /** The person whose page it is: her looks are the page's own chips */
  person?: { id: number; name: string } | null;
  className?: string;
}

/**
 * What the photos are narrowed to, on every photo view: a chip per
 * condition, each removable, « Ajouter un filtre » for more, « Effacer »
 * for none. The filter lives in the URL (useUrlFilter), so it follows from
 * one view to the next.
 */
export default function FilterBar({
  filter,
  onChange,
  noMenu = [],
  noChips = [],
  person = null,
  className,
}: FilterBarProps) {
  const vocabulary = useFilterVocabulary();
  const chips = filterChips(filter, vocabulary).filter(
    (chip) =>
      !noChips.includes(chip.kind) &&
      !(person && chip.key === `p-${String(person.id)}`),
  );
  return (
    <div
      role="group"
      aria-label="Filtres"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          chip={chip}
          onRemove={() => {
            onChange(chip.remove(filter));
          }}
        />
      ))}
      <AddFilter
        filter={filter}
        onChange={onChange}
        vocabulary={vocabulary}
        noMenu={noMenu}
        person={person}
        compact={chips.length > 0}
      />
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => {
            onChange(NO_URL_FILTER);
          }}
          className="touch-target inline-flex h-7 items-center rounded-full px-2 text-[13px] font-medium text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
        >
          Effacer
        </button>
      )}
    </div>
  );
}

function Chip({ chip, onRemove }: { chip: FilterChip; onRemove: () => void }) {
  const Icon = chipIcon(chip);
  return (
    <span className="inline-flex h-8 animate-fade-in items-center gap-1.5 rounded-full bg-surface-sunken pl-1 pr-1 text-[13px] font-medium text-ink">
      {chip.kind === "person" ? (
        <FaceThumb
          faceId={chip.faceId ?? null}
          className="h-6 w-6 rounded-full"
        />
      ) : chip.hue ? (
        <span
          aria-hidden
          className={cn(
            "ml-1.5 h-3 w-3 rounded-full ring-1 ring-inset ring-ink/15",
            HUE_SWATCH[chip.hue],
          )}
        />
      ) : Icon ? (
        <Icon className="ml-1.5 h-3.5 w-3.5 text-ink-muted" aria-hidden />
      ) : null}
      <span className="max-w-[16rem] truncate pl-0.5">{chip.label}</span>
      <button
        type="button"
        aria-label={`Retirer « ${chip.label} »`}
        title="Retirer"
        onClick={onRemove}
        className="touch-target inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

type Panel =
  | "people"
  | "looks"
  | "colors"
  | "scenes"
  | "animals"
  | "dates"
  | "words";

const SCENE_GROUPS: readonly TagGroup[] = ["scene", "lieu", "moment", "chose"];

const SEASONS = ["Printemps", "Été", "Automne", "Hiver", "Noël"];

/** The people the filter already puts on the photos, by its URL and its words. */
function peopleOf(filter: UrlFilter, vocabulary: FilterVocabulary | null) {
  const ids = new Set([
    ...filter.people,
    ...filter.faces.flatMap((face) =>
      face.person === null ? [] : [face.person],
    ),
  ]);
  if (vocabulary && filter.q)
    for (const part of understandQuery(
      filter.q,
      vocabulary.people,
      vocabulary.tagged,
    ).parts)
      if (part.kind === "person") ids.add(part.personId);
  return [...ids];
}

function AddFilter({
  filter,
  onChange,
  vocabulary,
  noMenu,
  person,
  compact,
}: {
  filter: UrlFilter;
  onChange: (next: UrlFilter) => void;
  vocabulary: FilterVocabulary | null;
  noMenu: readonly MenuEntry[];
  person: { id: number; name: string } | null;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Each panel starts on its first control
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>("[data-autofocus], [role=dialog] button")
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, panel]);

  const apply = (next: UrlFilter) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const entries: { panel: Panel; label: string; icon: LucideIcon }[] = [
    { panel: "people", label: "Personnes", icon: UsersRound },
    { panel: "looks", label: "Expression", icon: Smile },
    ...(noMenu.includes("color")
      ? []
      : [{ panel: "colors" as const, label: "Couleur", icon: Palette }]),
    { panel: "scenes", label: "Scène et lieu", icon: Mountain },
    { panel: "animals", label: "Animaux", icon: PawPrint },
    ...(noMenu.includes("date")
      ? []
      : [{ panel: "dates" as const, label: "Période", icon: CalendarDays }]),
    { panel: "words", label: "Mots", icon: Type },
  ];
  const current = entries.find((entry) => entry.panel === panel);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setPanel(null);
          setOpen((o) => !o);
        }}
        className={cn(
          "touch-target inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3 text-[13px] font-medium transition-colors duration-150",
          open
            ? "border-ink-muted bg-surface-sunken text-ink"
            : "border-line-strong text-ink-soft hover:border-ink-muted hover:text-ink",
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {compact ? "Filtre" : "Ajouter un filtre"}
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={current ? current.label : "Ajouter un filtre"}
          className="absolute left-0 top-full z-dialog mt-2 w-[min(22rem,calc(100vw-2rem))] animate-rise-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
        >
          {current ? (
            <>
              <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
                <button
                  type="button"
                  aria-label="Retour"
                  onClick={() => {
                    setPanel(null);
                  }}
                  className="touch-target inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <span className="text-sm font-semibold text-ink">
                  {current.label}
                </span>
              </div>
              <div className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
                <PanelContent
                  panel={current.panel}
                  filter={filter}
                  vocabulary={vocabulary}
                  person={person}
                  onApply={apply}
                />
              </div>
            </>
          ) : (
            <ul className="py-1">
              {entries.map(({ panel: entry, label, icon: Icon }) => (
                <li key={entry}>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel(entry);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-ink-muted"
                      aria-hidden
                    />
                    <span className="flex-1">{label}</span>
                    <ChevronRight
                      className="h-4 w-4 text-ink-faint"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
              <li className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  aria-pressed={filter.only}
                  onClick={() => {
                    apply({ ...filter, only: !filter.only });
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <UserX
                    className="h-4 w-4 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                  <span className="flex-1">
                    {peopleOf(filter, vocabulary).length > 0 || person
                      ? "Personne d'autre"
                      : "Sans personne"}
                  </span>
                  {filter.only && (
                    <Check className="h-4 w-4 text-ink" aria-hidden />
                  )}
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const OPTION =
  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink";

function PanelContent({
  panel,
  filter,
  vocabulary,
  person,
  onApply,
}: {
  panel: Panel;
  filter: UrlFilter;
  vocabulary: FilterVocabulary | null;
  person: { id: number; name: string } | null;
  onApply: (next: UrlFilter) => void;
}) {
  if (!vocabulary && panel !== "colors" && panel !== "words")
    return (
      <div role="status" aria-label="Chargement" className="space-y-2 p-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-6 w-3/5" />
      </div>
    );
  switch (panel) {
    case "people":
      return (
        <PeoplePanel
          filter={filter}
          vocabulary={vocabulary}
          onApply={onApply}
        />
      );
    case "looks":
      return (
        <LooksPanel
          filter={filter}
          vocabulary={vocabulary}
          person={person}
          onApply={onApply}
        />
      );
    case "colors":
      return <ColorsPanel filter={filter} onApply={onApply} />;
    case "scenes":
    case "animals":
      return (
        <TagsPanel
          groups={panel === "animals" ? ["animal"] : SCENE_GROUPS}
          filter={filter}
          vocabulary={vocabulary}
          onApply={onApply}
        />
      );
    case "dates":
      return (
        <DatesPanel filter={filter} vocabulary={vocabulary} onApply={onApply} />
      );
    case "words":
      return <WordsPanel filter={filter} onApply={onApply} />;
  }
}

function PeoplePanel({
  filter,
  vocabulary,
  onApply,
}: {
  filter: UrlFilter;
  vocabulary: FilterVocabulary | null;
  onApply: (next: UrlFilter) => void;
}) {
  const [typed, setTyped] = useState("");
  const taken = new Set(peopleOf(filter, vocabulary));
  const term = normalizeTextForSearch(typed);
  const people = (vocabulary?.people ?? []).filter(
    (p) => !taken.has(p.id) && normalizeTextForSearch(p.name).includes(term),
  );
  return (
    <>
      <input
        data-autofocus
        type="search"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
        placeholder="Un prénom"
        aria-label="Chercher une personne"
        className="mb-1 h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink-muted focus:outline-none"
      />
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={OPTION}
              onClick={() => {
                onApply({ ...filter, people: [...filter.people, p.id] });
              }}
            >
              <FaceThumb
                faceId={p.coverFaceId}
                className="h-7 w-7 rounded-full"
              />
              <span className="truncate">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function LooksPanel({
  filter,
  vocabulary,
  person,
  onApply,
}: {
  filter: UrlFilter;
  vocabulary: FilterVocabulary | null;
  person: { id: number; name: string } | null;
  onApply: (next: UrlFilter) => void;
}) {
  const names = new Map((vocabulary?.people ?? []).map((p) => [p.id, p.name]));
  const candidates = [
    ...(person ? [person] : []),
    ...peopleOf(filter, vocabulary)
      .filter((id) => id !== person?.id)
      .map((id) => ({ id, name: names.get(id) ?? "Une personne" })),
  ];
  const [whose, setWhose] = useState<number | null>(candidates[0]?.id ?? null);
  const add = (expression: Expression) => {
    // Her look says she is there: one chip, not two. Her name in the words
    // goes, the looks they bound to her come along.
    const parts = vocabulary
      ? understandQuery(filter.q, vocabulary.people, vocabulary.tagged).parts
      : [];
    const named = parts.filter(
      (part) =>
        (part.kind === "person" && part.personId === whose) ||
        (part.kind === "expression" &&
          part.people.length === 1 &&
          part.people[0] === whose),
    );
    const said = named.flatMap((part) =>
      part.kind === "expression"
        ? [{ person: whose, expression: part.expression }]
        : [],
    );
    onApply({
      ...filter,
      q: removeParts(filter.q, named),
      people: filter.people.filter((id) => id !== whose),
      faces: [...filter.faces, ...said, { person: whose, expression }],
    });
  };
  const has = (expression: Expression) =>
    filter.faces.some((f) => f.person === whose && f.expression === expression);
  return (
    <>
      {candidates.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Le visage de"
          className="mb-2 flex flex-wrap gap-1 px-0.5"
        >
          {[...candidates, { id: null, name: "Quelqu'un" }].map((c) => (
            <button
              key={c.id ?? "anyone"}
              type="button"
              role="radio"
              aria-checked={whose === c.id}
              onClick={() => {
                setWhose(c.id);
              }}
              className={cn(
                "touch-target inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors duration-150",
                whose === c.id
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-ink-soft hover:border-ink-muted hover:text-ink",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      <ul>
        {EXPRESSIONS.filter((e) => !has(e)).map((expression) => {
          const Icon = EXPRESSION_ICONS[expression];
          return (
            <li key={expression}>
              <button
                type="button"
                className={OPTION}
                onClick={() => {
                  add(expression);
                }}
              >
                <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
                {EXPRESSION_LABELS[expression]}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ColorsPanel({
  filter,
  onApply,
}: {
  filter: UrlFilter;
  onApply: (next: UrlFilter) => void;
}) {
  const set = (colors: ColorFilter) => {
    onApply({ ...filter, colors });
  };
  return (
    <>
      <div className="grid grid-cols-6 gap-1 p-1">
        {HUES.map((hue) => {
          const pressed = filter.colors.color === hue;
          return (
            <button
              key={hue}
              type="button"
              aria-pressed={pressed}
              aria-label={HUE_LABELS[hue]}
              title={HUE_LABELS[hue]}
              onClick={() => {
                set({ ...filter.colors, color: pressed ? null : hue });
              }}
              className="touch-target group flex h-10 items-center justify-center rounded-md transition-colors hover:bg-surface-sunken"
            >
              <span
                aria-hidden
                className={cn(
                  "h-6 w-6 rounded-full transition-transform duration-150 ease-out-soft group-hover:scale-110",
                  HUE_SWATCH[hue],
                  pressed
                    ? "ring-2 ring-ink ring-offset-2 ring-offset-surface"
                    : "ring-1 ring-inset ring-ink/15",
                )}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5 border-t border-line px-1 pt-2">
        {COLOR_TONES.map((tone) => {
          const pressed = filter.colors.tone === tone;
          return (
            <button
              key={tone}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                set({ ...filter.colors, tone: pressed ? null : tone });
              }}
              className={cn(
                "touch-target inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors duration-150",
                pressed
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-ink-soft hover:border-ink-muted hover:text-ink",
              )}
            >
              {TONE_LABELS[tone]}
            </button>
          );
        })}
      </div>
    </>
  );
}

function TagsPanel({
  groups,
  filter,
  vocabulary,
  onApply,
}: {
  groups: readonly TagGroup[];
  filter: UrlFilter;
  vocabulary: FilterVocabulary | null;
  onApply: (next: UrlFilter) => void;
}) {
  const [negated, setNegated] = useState(false);
  const taken = new Set(filter.tags.map((t) => t.tag));
  const tags = (vocabulary?.tags ?? []).filter(
    (t) => groups.includes(t.group) && !taken.has(t.tag),
  );
  if (tags.length === 0)
    return (
      <p className="px-2.5 py-6 text-center text-sm text-ink-muted">
        Pas encore de scènes reconnues.
      </p>
    );
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Sur les photos"
        className="mb-2 flex gap-1 px-0.5"
      >
        {[
          { value: false, label: "Avec" },
          { value: true, label: "Sans" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={negated === option.value}
            onClick={() => {
              setNegated(option.value);
            }}
            className={cn(
              "touch-target inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors duration-150",
              negated === option.value
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink-soft hover:border-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2">
        {tags.map((t) => (
          <li key={t.tag}>
            <button
              type="button"
              className={OPTION}
              onClick={() => {
                onApply({
                  ...filter,
                  tags: [...filter.tags, { tag: t.tag, negated }],
                });
              }}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DatesPanel({
  filter,
  vocabulary,
  onApply,
}: {
  filter: UrlFilter;
  vocabulary: FilterVocabulary | null;
  onApply: (next: UrlFilter) => void;
}) {
  const years = useMemo(() => {
    const span = vocabulary?.years;
    if (!span) return [];
    return Array.from(
      { length: span.to - span.from + 1 },
      (_, i) => span.to - i,
    );
  }, [vocabulary]);
  const add = (words: string) => {
    onApply({ ...filter, dates: [...filter.dates, words] });
  };
  const pill =
    "touch-target inline-flex h-8 items-center justify-center rounded-md border border-line px-2.5 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-ink-muted hover:text-ink";
  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-0.5 pb-2">
        {SEASONS.map((season) => (
          <button
            key={season}
            type="button"
            className={pill}
            onClick={() => {
              add(season.toLowerCase());
            }}
          >
            {season}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5 border-t border-line px-0.5 pt-2">
        {years.map((year) => (
          <button
            key={year}
            type="button"
            className={cn(pill, "tabular")}
            onClick={() => {
              add(String(year));
            }}
          >
            {year}
          </button>
        ))}
      </div>
    </>
  );
}

function WordsPanel({
  filter,
  onApply,
}: {
  filter: UrlFilter;
  onApply: (next: UrlFilter) => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <form
      className="flex gap-2 p-0.5"
      onSubmit={(e) => {
        e.preventDefault();
        const words = typed.trim();
        if (words) onApply({ ...filter, q: `${filter.q} ${words}`.trim() });
      }}
    >
      <input
        data-autofocus
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
        placeholder="Ce que montrent les photos"
        aria-label="Ce que montrent les photos"
        className="h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm text-ink placeholder:text-ink-muted focus:border-ink-muted focus:outline-none"
      />
      <button
        type="submit"
        className="touch-target inline-flex h-9 items-center rounded-full bg-ink px-3 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
      >
        Ajouter
      </button>
    </form>
  );
}
