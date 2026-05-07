import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Search,
  Home,
  CalendarDays,
  Users,
  MessageSquare,
  Mail,
  Building2,
  BarChart3,
  KanbanSquare,
  Lock,
  FolderPlus,
  Folder,
  Settings,
  BookText,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Monitor,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useFolders, FOLDER_COLORS } from "./FoldersProvider";
import { FolderDialog } from "./FolderDialog";
import { useIsMobile } from "../hooks/use-mobile";
import { SpotlightSearch } from "./SpotlightSearch";
import { useAuth } from "./AuthProvider";

type SidebarContentProps = {
  collapsed: boolean;
  currentPath: string;
  theme: "light" | "dark";
  followingSystem: boolean;
  onToggleCollapsed: () => void;
  onFollowSystemTheme: () => void;
  onOpenSearch: () => void;
  onCloseMobileNav?: () => void;
};

export function Sidebar() {
  const location = useLocation();
  const { theme, preference, setTheme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isShortcut) return;
      event.preventDefault();
      setSearchOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {isMobile ? (
        <>
          <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-sidebar-border bg-background/90 px-4 backdrop-blur">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="rounded-xl border border-border bg-card/70 p-2 text-foreground transition hover:bg-accent"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link to="/" className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-sm font-bold text-background">
                N
              </div>
              <span className="truncate font-serif-display text-2xl leading-none tracking-tight">Notable</span>
            </Link>

            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="rounded-xl border border-border bg-card/70 p-2 text-foreground transition hover:bg-accent"
            >
              {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
          </header>

          <div
            className={`fixed inset-0 z-50 bg-black/45 transition-opacity duration-200 ${
              mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          <aside
            className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[var(--shadow-elevated)] transition-transform duration-200 ease-out ${
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
              <Link to="/" className="flex min-w-0 items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-[14px] font-bold text-background">
                  N
                </div>
                <span className="truncate font-serif-display text-2xl leading-none tracking-tight">Notable</span>
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <SidebarContent
              collapsed={false}
              currentPath={location.pathname}
              theme={theme}
              followingSystem={preference === "system"}
              onToggleCollapsed={() => undefined}
              onFollowSystemTheme={() => setTheme("system")}
              onOpenSearch={() => setSearchOpen(true)}
              onCloseMobileNav={() => setMobileOpen(false)}
            />
          </aside>
        </>
      ) : (
        <aside
          className={`flex h-screen ${collapsed ? "w-16" : "w-64"} shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out`}
        >
          <SidebarContent
            collapsed={collapsed}
            currentPath={location.pathname}
            theme={theme}
            followingSystem={preference === "system"}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            onFollowSystemTheme={() => setTheme("system")}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </aside>
      )}

      <SpotlightSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

function SidebarContent({
  collapsed,
  currentPath,
  theme,
  followingSystem,
  onToggleCollapsed,
  onFollowSystemTheme,
  onOpenSearch,
  onCloseMobileNav,
}: SidebarContentProps) {
  const { folders, setFolderColor } = useFolders();
  const { user } = useAuth();
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const showWorkspaceHeader = !onCloseMobileNav;
  const workspaceLabel = user?.full_name || user?.email || "Notable";
  const workspaceMeta = user?.email || "Meeting workspace";
  const workspaceInitial = workspaceLabel.charAt(0).toUpperCase();

  const itemClass = (active: boolean) =>
    `group flex items-center gap-3 rounded-lg ${collapsed ? "justify-center px-2" : "px-3"} py-2 text-sm transition-colors ${
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-hide">
      {showWorkspaceHeader && (
        <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "justify-between"} px-3 pt-4 pb-2`}>
          {collapsed ? (
            <>
              <Link
                to="/"
                className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-[12px] font-bold text-background"
              >
                N
              </Link>
              <button
                onClick={onToggleCollapsed}
                aria-label="Expand sidebar"
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <Link to="/" className="flex min-w-0 items-center gap-2" onClick={onCloseMobileNav}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-[14px] font-bold text-background">
                  N
                </div>
                <span className="truncate font-serif-display text-2xl leading-none tracking-tight">Notable</span>
              </Link>
              <button
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

      <div className="px-3 pt-2">
        {collapsed ? (
          <button
            className="flex w-full items-center justify-center rounded-lg border border-sidebar-border/60 bg-background/30 p-2 text-sidebar-foreground/70 transition hover:bg-sidebar-accent/50"
            aria-label="Search"
            onClick={onOpenSearch}
          >
            <Search className="h-4 w-4" />
          </button>
        ) : (
          <button
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-background/30 px-3 py-2 text-sm text-sidebar-foreground/70 transition hover:bg-sidebar-accent/50"
            onClick={onOpenSearch}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search</span>
            {!onCloseMobileNav && (
              <span className="rounded border border-sidebar-border/70 bg-sidebar/40 px-1.5 py-0.5 text-[10px] font-medium">
                Ctrl+K
              </span>
            )}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="mt-3 px-3">
          <button
            type="button"
            onClick={onFollowSystemTheme}
            disabled={followingSystem}
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-background/30 px-3 py-2 text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-accent/50 disabled:cursor-default disabled:opacity-75 disabled:hover:bg-background/30"
          >
            <Monitor className="h-4 w-4" />
            <span className="flex-1 text-left">Following system theme</span>
            <span className="text-xs uppercase tracking-wide text-sidebar-foreground/55">{theme}</span>
          </button>
        </div>
      )}

      {collapsed && (
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={onFollowSystemTheme}
            disabled={followingSystem}
            aria-label="Follow system theme"
            className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
          >
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      )}

      <nav className="mt-3 space-y-0.5 px-2">
        <Link to="/" className={itemClass(currentPath === "/")} title="Home" onClick={onCloseMobileNav}>
          <Home className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Home</span>}
        </Link>
        <Link to="/shared" className={itemClass(currentPath === "/shared")} title="Shared with me" onClick={onCloseMobileNav}>
          <Users className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Shared with me</span>}
        </Link>
        <Link to="/calendar" className={itemClass(currentPath === "/calendar")} title="Calendar" onClick={onCloseMobileNav}>
          <CalendarDays className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Calendar</span>}
        </Link>
        <Link to="/chat" className={itemClass(currentPath === "/chat")} title="Chat" onClick={onCloseMobileNav}>
          <MessageSquare className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Chat</span>}
        </Link>
        <Link to="/readouts" className={itemClass(currentPath === "/readouts")} title="Readouts" onClick={onCloseMobileNav}>
          <Mail className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Readouts</span>}
        </Link>
        <Link to="/teams" className={itemClass(currentPath === "/teams")} title="My teams" onClick={onCloseMobileNav}>
          <Building2 className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">My teams</span>}
        </Link>
        <Link to="/analytics" className={itemClass(currentPath === "/analytics")} title="Analytics" onClick={onCloseMobileNav}>
          <BarChart3 className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Analytics</span>}
        </Link>
        <Link to="/tasks" className={itemClass(currentPath === "/tasks")} title="Tasks" onClick={onCloseMobileNav}>
          <KanbanSquare className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Tasks</span>}
        </Link>
        <Link
          to="/vocabulary"
          className={itemClass(currentPath === "/vocabulary")}
          title="Vocabulary"
          onClick={onCloseMobileNav}
        >
          <BookText className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Vocabulary</span>}
        </Link>
      </nav>

      {!collapsed && (
        <div className="mt-6 px-4 pb-1 text-xs uppercase tracking-wider text-sidebar-foreground/50">
          Spaces
        </div>
      )}

      <nav className={`${collapsed ? "mt-4" : ""} space-y-0.5 px-2`}>
        <Link to="/my-notes" className={itemClass(currentPath === "/my-notes")} title="My notes" onClick={onCloseMobileNav}>
          <Lock className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">My notes</span>}
        </Link>
        <button
          type="button"
          onClick={() => {
            setFolderDialogOpen(true);
            setColorPickerFor(null);
          }}
          className={itemClass(false) + " w-full text-left"}
          title="Add folder"
        >
          <FolderPlus className="h-4 w-4 opacity-80" />
          {!collapsed && <span className="flex-1 truncate">Add folder</span>}
        </button>

        {folders.map((f) => (
          <div key={f.id} className="relative">
            <Link
              to="/folders/$folderId"
              params={{ folderId: f.id }}
              className={itemClass(currentPath === `/folders/${f.id}`)}
              title={f.name}
              onClick={onCloseMobileNav}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setColorPickerFor(colorPickerFor === f.id ? null : f.id);
                }}
                aria-label="Change folder color"
                className="rounded p-0.5 transition hover:scale-110"
              >
                <Folder
                  className="h-4 w-4"
                  style={{ color: f.color ?? "currentColor", fill: f.color ? `${f.color}33` : "transparent" }}
                />
              </button>
              {!collapsed && <span className="flex-1 truncate">{f.name}</span>}
              {!collapsed && f.notes.length > 0 && (
                <span className="text-[10px] text-sidebar-foreground/50">{f.notes.length}</span>
              )}
            </Link>
            {colorPickerFor === f.id && !collapsed && (
              <div
                className="absolute left-10 top-9 z-50 flex max-w-[calc(100vw-5rem)] flex-wrap gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-[var(--shadow-elevated)]"
                onMouseLeave={() => setColorPickerFor(null)}
              >
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setFolderColor(f.id, c);
                      setColorPickerFor(null);
                    }}
                    className={`h-5 w-5 rounded-full border-2 ${f.color === c ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      <div
        className={`border-t border-sidebar-border px-3 py-3 text-sm ${
          collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2"
        } ${!collapsed && currentPath === "/settings" ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
      >
        <Link
          to="/settings"
          onClick={onCloseMobileNav}
          className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition ${
            collapsed ? "w-full justify-center" : "flex-1"
          } ${currentPath === "/settings" ? "text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/40"}`}
          title="Open settings"
        >
          <div
            className={`flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-foreground/30 to-foreground/50 font-bold text-background ${
              collapsed ? "h-10 w-10 text-xs" : "h-6 w-6 text-[10px]"
            }`}
          >
            {workspaceInitial}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-medium">{workspaceLabel}</div>
              <div className="truncate text-[11px] text-sidebar-foreground/55">{workspaceMeta}</div>
            </div>
          )}
        </Link>

        {!collapsed ? (
          <Link
            to="/settings"
            onClick={onCloseMobileNav}
            aria-label="Open settings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border/70 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Open settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <Link
            to="/settings"
            onClick={onCloseMobileNav}
            aria-label="Open settings"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              currentPath === "/settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70"
            }`}
            title="Open settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      <FolderDialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} />
    </div>
  );
}
