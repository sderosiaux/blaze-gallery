"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Gauge,
  Heart,
  Library,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share2,
  Shuffle,
  X,
  type LucideIcon,
} from "lucide-react";
import BrandMark from "@/components/BrandMark";
import GitHubIcon from "@/components/GitHubIcon";
import AuthButton from "@/components/auth/AuthButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLayout } from "@/contexts/LayoutContext";
import { IconButton, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";

interface NavLinkItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const PRIMARY_NAV: NavLinkItem[] = [
  { href: "/", label: "Library", icon: Library, match: (p) => p === "/" || p.startsWith("/folder") },
  { href: "/timeline", label: "Timeline", icon: CalendarDays, match: (p) => p.startsWith("/timeline") },
  { href: "/favorites", label: "Favorites", icon: Heart, match: (p) => p.startsWith("/favorites") },
  { href: "/admin/shares", label: "Shared links", icon: Share2, match: (p) => p.startsWith("/admin/shares") },
];

const ADMIN_NAV: NavLinkItem[] = [
  { href: "/stats", label: "Statistics", icon: BarChart3, match: (p) => p.startsWith("/stats") },
  { href: "/audit", label: "Storage audit", icon: Gauge, match: (p) => p.startsWith("/audit") },
];

const ADMIN_OPEN_KEY = "blaze:admin-nav-open";

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavLinkItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-md text-sm transition-colors duration-150",
        collapsed ? "justify-center px-0" : "px-3",
        active ? "bg-surface font-medium text-ink shadow-lift" : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-accent" : "text-ink-muted group-hover:text-ink-soft")} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function SidebarContent({
  collapsed,
  onNavigate,
  showNav,
  authEnabled,
  onToggleCollapse,
  onClose,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  showNav: boolean;
  authEnabled: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const toast = useToast();
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const onAdminRoute = ADMIN_NAV.some((item) => item.match(pathname));

  useEffect(() => {
    setAdminOpen(onAdminRoute || localStorage.getItem(ADMIN_OPEN_KEY) === "1");
  }, [onAdminRoute]);

  const toggleAdmin = () => {
    setAdminOpen((open) => {
      localStorage.setItem(ADMIN_OPEN_KEY, open ? "0" : "1");
      return !open;
    });
  };

  const surprise = async () => {
    setSurpriseLoading(true);
    try {
      const response = await fetch("/api/stats/random-folder");
      const data = await response.json();
      if (data.success) {
        onNavigate?.();
        router.push(data.data.path === "" ? "/" : `/folder/${data.data.path}`);
      } else {
        toast.show("No album with photos was found.", "error");
      }
    } catch {
      toast.show("Couldn't pick a random album. Try again.", "error");
    } finally {
      setSurpriseLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-[var(--topbar-height)] shrink-0 items-center", collapsed ? "justify-center" : "justify-between pl-5 pr-3")}>
        <Link href="/" onClick={onNavigate} aria-label="Blaze Gallery, home" className="rounded">
          <BrandMark compact={collapsed} />
        </Link>
        {onClose && <IconButton icon={X} label="Close menu" size="sm" onClick={onClose} />}
      </div>

      {showNav && (
        <nav aria-label="Main" className={cn("flex-1 overflow-y-auto pb-4 pt-4", collapsed ? "px-3" : "px-3")}>
          <ul className="space-y-0.5">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <NavRow item={item} active={item.match(pathname)} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={surprise}
                disabled={surpriseLoading}
                aria-label={collapsed ? "Surprise me: open a random album" : undefined}
                title={collapsed ? "Surprise me" : "Open a random album"}
                className={cn(
                  "group flex h-10 w-full items-center gap-3 rounded-md text-sm text-ink-soft transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:opacity-60",
                  collapsed ? "justify-center" : "px-3",
                )}
              >
                <Shuffle className={cn("h-[18px] w-[18px] shrink-0 text-ink-muted group-hover:text-ink-soft", surpriseLoading && "animate-pulse")} aria-hidden />
                {!collapsed && <span>Surprise me</span>}
              </button>
            </li>
          </ul>

          <div className="mt-6">
            {collapsed ? (
              <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-line" />
            ) : (
              <button
                type="button"
                onClick={toggleAdmin}
                aria-expanded={adminOpen}
                className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left"
              >
                <span className="kicker">Admin</span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-ink-muted transition-transform duration-200", adminOpen ? "" : "-rotate-90")} aria-hidden />
              </button>
            )}
            {(adminOpen || collapsed) && (
              <ul className="mt-1 space-y-0.5">
                {ADMIN_NAV.map((item) => (
                  <li key={item.href}>
                    <NavRow item={item} active={item.match(pathname)} collapsed={collapsed} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>
      )}
      {!showNav && <div className="flex-1" />}

      <div className={cn("shrink-0 space-y-2 border-t border-line py-3", collapsed ? "px-3" : "px-3")}>
        {authEnabled && (
          <div className={cn("flex", collapsed ? "justify-center" : "")}>
            <AuthButton compact={collapsed} />
          </div>
        )}
        <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}>
          <a
            href="https://github.com/sderosiaux/blaze-gallery"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
            className={cn(
              "flex h-9 items-center gap-2 rounded-md text-xs text-ink-muted transition-colors hover:text-ink",
              collapsed ? "w-9 justify-center" : "px-3",
            )}
          >
            <GitHubIcon size={16} />
            {!collapsed && <span>Source</span>}
          </a>
          {onToggleCollapse && (
            <IconButton
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              label={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
              size="sm"
              onClick={onToggleCollapse}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TopSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams()?.get("q") ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  // Follows Back/Forward and in-app links between /search?q= values.
  useEffect(() => {
    if (pathname === "/search") setValue(query);
  }, [pathname, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isK || (e.key === "/" && !isTypingTarget(e.target))) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    inputRef.current?.blur();
  };

  return (
    <form role="search" onSubmit={submit} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && inputRef.current?.blur()}
        placeholder="Search the library"
        aria-label="Search albums and photos"
        className="h-10 w-full rounded-full border border-line bg-surface/70 pl-10 pr-14 text-sm text-ink placeholder:text-ink-muted transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] text-ink-muted sm:block">
          ⌘K
        </kbd>
      )}
    </form>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sidebarCollapsed, sidebarAnimated, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useLayout();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/config")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then(({ enabled }) => setAuthEnabled(Boolean(enabled)))
      .catch(() => setAuthEnabled(false));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target) && !document.querySelector('[aria-modal="true"]')) {
        toggleSidebar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, setMobileNavOpen]);

  const showNav = mounted && !authLoading && (!authEnabled || isAuthenticated);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        aria-label="Sidebar"
        data-collapsed={sidebarCollapsed}
        className={cn(
          "fixed inset-y-0 left-0 z-sidebar hidden border-r border-line bg-paper lg:block",
          sidebarAnimated && "transition-[width] duration-200 ease-out-soft",
          sidebarCollapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-expanded)]",
        )}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          showNav={showNav}
          authEnabled={mounted && authEnabled}
          onToggleCollapse={toggleSidebar}
        />
      </aside>

      {/* Mobile drawer */}
      <div className={cn("fixed inset-0 z-overlay lg:hidden", mobileNavOpen ? "" : "pointer-events-none")} aria-hidden={!mobileNavOpen}>
        <div
          onClick={() => setMobileNavOpen(false)}
          className={cn("absolute inset-0 bg-scrim/40 transition-opacity duration-200", mobileNavOpen ? "opacity-100" : "opacity-0")}
        />
        <div
          role="dialog"
          aria-modal={mobileNavOpen || undefined}
          aria-label="Menu"
          className={cn(
            "absolute inset-y-0 left-0 w-[min(18rem,85vw)] bg-paper transition-transform duration-200 ease-out-soft",
            mobileNavOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
          )}
        >
          {mobileNavOpen && (
            <SidebarContent
              collapsed={false}
              showNav={showNav}
              authEnabled={mounted && authEnabled}
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => setMobileNavOpen(false)}
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          sidebarAnimated && "transition-[padding] duration-200 ease-out-soft",
          sidebarCollapsed ? "lg:pl-[var(--sidebar-collapsed)]" : "lg:pl-[var(--sidebar-expanded)]",
        )}
      >
        <header
          className={cn(
            "sticky top-0 z-topbar flex h-[var(--topbar-height)] items-center gap-3 px-4 transition-[background-color,border-color] duration-200 sm:px-8 lg:px-12",
            scrolled ? "border-b border-line bg-paper/85 backdrop-blur-md" : "border-b border-transparent bg-paper",
          )}
        >
          <IconButton icon={Menu} label="Open menu" className="-ml-1 lg:hidden" onClick={() => setMobileNavOpen(true)} />
          <Link href="/" aria-label="Blaze Gallery, home" className="mr-1 shrink-0 rounded lg:hidden">
            <BrandMark compact />
          </Link>
          {showNav && (
            <Suspense fallback={<div className="h-10 w-full max-w-xl rounded-full border border-line bg-surface/70" />}>
              <TopSearch />
            </Suspense>
          )}
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1680px] px-4 pb-24 focus:outline-none sm:px-8 lg:px-12">
          {children}
        </main>
      </div>
    </div>
  );
}
