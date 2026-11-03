import { CalendarSettingsPanel } from "../calendar/CalendarSettingsPanel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { showToast, ToastHost } from "../../app/toast";
import {
  ADD_COURSE_SHORTCUT_EVENT,
  IMPORT_MATERIALS_SHORTCUT_EVENT,
} from "../../app/shortcuts";
import { BandalMark } from "../../components/BandalMark";
import { Button } from "../../components/ui/button";
import { useLocale, useT } from "../../i18n";
import { invoke, onPush } from "../../lib/ipc";
import { useCoursesStore } from "../../stores/coursesStore";
import { useUiStore } from "../../stores/uiStore";
import { usePluginsStore } from "../../stores/pluginsStore";
import {
  AGENT_PROVIDERS,
  type AgentAvailability,
  type AgentProvider,
} from "../../../../shared/types/agent-events";
import { acquireAgentConnection, refreshAgentConnection, useAgentConnectionStore } from "../chat/agentConnectionStore";
import type { Course } from "../../../../shared/types/course";
import {
  isSameAppearance,
  pickAppearance,
} from "../../../../shared/appearance";
import type { AppearanceSettings } from "../../../../shared/appearance";
import {
  isSettingsCategoryId,
  normalizeSettingsCategoryId,
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  type SettingsNavigationTarget,
  type SettingsPanelId,
  type SettingsGroupId,
} from "../../../../shared/settingsCategories";
import {
  DEFAULT_SETTINGS,
  type Density,
  type EditorFont,
  type FontScale,
  type Settings,
  type ThemePreference,
} from "../../../../shared/types/settings";
import { AccountPanel } from "./AccountPanel";
import { SyncPanel } from "./sync/SyncPanel";
import { AdvancedPanel } from "./advanced/AdvancedPanel";
import { AssistantPanel } from "./assistant/AssistantPanel";
import { ExperimentalPanel } from "./advanced/ExperimentalPanel";
import { BrowserSettingsPanel } from "./browser/BrowserSettingsPanel";
import {
  AboutPanel,
  AiPanel,
  AppearancePanel,
  CoursesPanel,
  GeneralPanel,
} from "./SettingsPanels";
import { PluginsCategoryPanel } from "./PluginsCategoryPanel";
import { NotificationsPanel } from "./notifications/NotificationsPanel";
import { PermissionsPanel } from "./permissions/PermissionsPanel";
import { PrivacyPanel } from "./privacy/PrivacyPanel";
import { ShortcutsPanel } from "./shortcuts/ShortcutsPanel";
import { UsagePanel } from "./usage/UsagePanel";
import { Icon } from "./SettingsIcon";
import {
  buildSettingsSearchIndex,
  paneSearchEntries,
  type ResolvedSettingsEntry,
} from "./search/catalog";
import {
  hasSettingsSearchQuery,
  matchesSettingsSearch,
  rankSettingsSearchItems,
} from "./search/settingsSearch";
import { SettingsSearchProvider } from "./kit/SettingsSearchContext";
import { SettingsEmptyState } from "./kit/SettingsKit";
import { revealSettingsTarget } from "./kit/settingsDeepLink";
import { UniversitySettingsPanel } from "./UniversitySettingsPanel";
import { WidgetSettingsPanel } from "./WidgetSettingsPanel";
import { TabsSettingsPanel } from "./TabsSettingsPanel";
import {
  HELP_FOCUS_TARGET_EVENT,
  milestoneDestination,
} from "../help/HelpHub";
import { MilestonesOverlay } from "../help/MilestonesOverlay";
import { ProgressRing } from "../help/ProgressRing";
import { useMilestones, type MilestoneId } from "../help/milestonesStore";
import { useTourStore } from "../onboarding/tour/tourStore";
import "../help/help.css";
import "./settings-app.css";
import "./settings-panels.css";

interface Category {
  id: SettingsPanelId;
  group: SettingsGroupId;
  label: string;
  description: string;
}

interface SettingsAppProps {
  onClose: () => void;
  /** Category to open on; unknown/null falls back to General. */
  initialCategory?: string | null;
}

/** Orca debounces the applied query by 150ms; clearing applies at once. */
const SEARCH_DEBOUNCE_MS = 150;
/** Matching rows listed under a category while searching. */
const MAX_SEARCH_HITS = 3;

type ProviderState<T> = Record<AgentProvider, T>;

export function SettingsApp({
  onClose,
  initialCategory = null,
}: SettingsAppProps): JSX.Element {
  const t = useT();
  const leftRailOpen = useUiStore((state) => state.leftRailOpen);
  const isSettingsOpen = useUiStore((state) => state.isSettingsOpen);
  const locale = useLocale();
  const [activeCategory, setActiveCategory] = useState<SettingsPanelId>(() =>
    isSettingsCategoryId(initialCategory) ? normalizeSettingsCategoryId(initialCategory) : "general",
  );
  useEffect(() => {
    if (isSettingsCategoryId(initialCategory)) setActiveCategory(normalizeSettingsCategoryId(initialCategory));
  }, [initialCategory]);
  const [searchInput, setSearchInput] = useState("");
  const query = useUiStore((state) => state.settingsSearchQuery);
  const setSettingsSearchQuery = useUiStore((state) => state.setSettingsSearchQuery);
  const settingsTarget = useUiStore((state) => state.settingsTarget);
  const [pendingTarget, setPendingTarget] = useState<SettingsNavigationTarget | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [settingsLoadError, setSettingsLoadError] = useState(false);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    pickAppearance(DEFAULT_SETTINGS),
  );
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeErrorKey, setThemeErrorKey] = useState<string | null>(null);
  const connections = useAgentConnectionStore(state => state.connections);
  const availability = Object.fromEntries(AGENT_PROVIDERS.map(provider => [provider, connections[provider].availability])) as ProviderState<AgentAvailability | null>;
  const availabilityLoading = Object.fromEntries(AGENT_PROVIDERS.map(provider => [provider, connections[provider].loading || connections[provider].availability === null && connections[provider].availabilityError === null])) as ProviderState<boolean>;
  const availabilityError = Object.fromEntries(AGENT_PROVIDERS.map(provider => [provider, connections[provider].availabilityError])) as ProviderState<string | null>;
  const [agentProviderSaving, setAgentProviderSaving] = useState(false);
  const [agentProviderFeedbackKey, setAgentProviderFeedbackKey] = useState<
    string | null
  >(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const settingsPushVersion = useRef(0);
  const coursesRequest = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId);
  const plugins = usePluginsStore((state) => state.plugins);
  const milestoneProgress = useMilestones((state) => state.progress);
  const refreshMilestones = useMilestones((state) => state.refresh);

  const categories = useMemo<readonly Category[]>(
    () =>
      SETTINGS_CATEGORIES.filter(({ id }) => id !== "sync" || window.bandal?.syncUi === true).map(({ id, group }) => ({
        id,
        group,
        label: t(`settings.category.${id}.label`),
        description: t(`settings.category.${id}.description`),
      })),
    [t],
  );

  const active =
    categories.find((category) => category.id === activeCategory) ??
    categories[0]!;

  const searchIndex = useMemo(() => {
    // Plugin names and their manifest settings stay searchable (packs pane).
    const pluginEntries: ResolvedSettingsEntry[] = plugins.flatMap(({ manifest }) => [
      { id: `packs.plugin.${manifest.id}`, category: "packs" as const, title: manifest.name, keywords: [manifest.id] },
      ...(manifest.contributes.settings ?? []).map((field) => ({
        id: `packs.plugin.${manifest.id}.${field.key}`,
        category: "packs" as const,
        title: field.title,
        keywords: [manifest.name],
      })),
    ]);
    return buildSettingsSearchIndex(locale, pluginEntries);
  }, [locale, plugins]);

  const searching = hasSettingsSearchQuery(query);
  const rankedCategories = useMemo(
    () => rankSettingsSearchItems(query, categories, (category) => paneSearchEntries(searchIndex, category.id)),
    [categories, query, searchIndex],
  );
  const filteredCategories = useMemo(() => rankedCategories.map(({ item }) => item), [rankedCategories]);
  /** Up to three matching rows per category, shown under it in the sidebar. */
  const hitsByCategory = useMemo(() => {
    const hits = new Map<SettingsPanelId, ResolvedSettingsEntry[]>();
    if (!searching) return hits;
    for (const { item } of rankedCategories) {
      const rows = rankSettingsSearchItems(query, searchIndex.byCategory.get(item.id) ?? [], (entry) => entry)
        .map(({ item: entry }) => entry)
        // Plugin rows only identify the pack; they have no row to scroll to.
        .filter((entry) => !entry.id.startsWith("packs.plugin."));
      hits.set(item.id, rows.slice(0, MAX_SEARCH_HITS));
    }
    return hits;
  }, [query, rankedCategories, searchIndex, searching]);
  // Only a hit on the category's own name reveals every row; its broad
  // keyword list ("탭", "언어", …) would otherwise unfilter the whole pane.
  const paneMatches = useMemo(
    () => matchesSettingsSearch(query, { title: active.label }),
    [active.label, query],
  );

  // The input updates at once; the applied query (which re-filters every row)
  // trails it by 150ms. An emptied input clears immediately.
  useEffect(() => {
    if (searchInput.trim() === "") {
      setSettingsSearchQuery("");
      return;
    }
    const timer = window.setTimeout(() => setSettingsSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, setSettingsSearchQuery]);
  // A deep link clears the store query; mirror that into the input.
  useEffect(() => {
    if (query === "") setSearchInput((current) => (current.trim() === "" ? current : ""));
  }, [query]);

  // Keep the visible pane among the matches: fall back to the best match.
  useEffect(() => {
    if (!searching) return;
    const first = filteredCategories[0];
    if (first !== undefined && !filteredCategories.some((category) => category.id === activeCategory)) {
      setActiveCategory(first.id);
    }
  }, [activeCategory, filteredCategories, searching]);

  const navigateTo = useCallback((target: SettingsNavigationTarget): void => {
    if (!isSettingsCategoryId(target.category)) return;
    setActiveCategory(normalizeSettingsCategoryId(target.category));
    setPendingTarget(target);
  }, []);

  // Deep links from anywhere in the app (uiStore.openSettings(target)).
  useEffect(() => {
    if (settingsTarget !== null) navigateTo(settingsTarget);
  }, [navigateTo, settingsTarget]);

  // Scroll to + highlight the requested row once its panel has rendered.
  useEffect(() => {
    const sectionId = pendingTarget?.sectionId;
    const root = contentRef.current;
    if (sectionId === undefined || root === null) return;
    return revealSettingsTarget(root, sectionId);
  }, [activeCategory, pendingTarget]);

  const loadAvailability = useCallback((target?: AgentProvider): void => {
    for (const provider of target === undefined ? AGENT_PROVIDERS : [target]) void refreshAgentConnection(provider, true);
  }, []);

  const loadCourses = (showArchived: boolean): void => {
    const request = ++coursesRequest.current;
    setCoursesLoading(true);
    setCoursesError(null);
    void invoke("courses:list", { includeArchived: showArchived })
      .then((result) => {
        if (mountedRef.current && request === coursesRequest.current) setCourses(result.filter(course => course.workspaceKind !== 'study-space'));
      })
      .catch(() => {
        if (mountedRef.current && request === coursesRequest.current) setCoursesError("courses-failed");
      })
      .finally(() => {
        if (mountedRef.current && request === coursesRequest.current) setCoursesLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let pushed = false;
    setSettingsLoadError(false);
    const unsubscribe = onPush("settings:changed", ({ settings: next }) => {
      pushed = true;
      settingsPushVersion.current += 1;
      setSettingsLoadError(false);
      setSettings(next);
      setAppearance(pickAppearance(next));
    });

    void invoke("settings:get", {})
      .then((result) => {
        if (!active || pushed) return;
        setSettings(result);
        setAppearance(pickAppearance(result));
      })
      .catch(() => {
        if (active && !pushed) {
          setSettingsLoadError(true);
          setThemeErrorKey("settings.appearance.loadFailed");
        }
      });

    loadCourses(includeArchived);

    return () => {
      active = false;
      mountedRef.current = false;
      coursesRequest.current += 1;
      unsubscribe();
    };
  }, [loadAvailability, settingsAttempt]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const releases = AGENT_PROVIDERS.map(provider => acquireAgentConnection(provider, true));
    return () => releases.forEach(release => release());
  }, [isSettingsOpen]);

  useEffect(() => {
    void refreshMilestones(selectedCourseId);
  }, [refreshMilestones, selectedCourseId]);

  /**
   * Every appearance axis saves the same way: paint optimistically, persist
   * the patch, then reconcile with whatever main actually stored (and roll
   * the whole set back on failure — a half-applied appearance is worse than
   * neither).
   */
  const saveAppearance = (patch: Partial<AppearanceSettings>): void => {
    if (themeSaving) return;
    const previous = appearance;
    const pushVersion = settingsPushVersion.current;
    const next = { ...previous, ...patch };
    if (isSameAppearance(next, previous)) return;
    setAppearance(next);
    setThemeSaving(true);
    setThemeErrorKey(null);

    void invoke("settings:set", patch)
      .then((nextSettings) => {
        if (!mountedRef.current || pushVersion !== settingsPushVersion.current) return;
        setSettings(nextSettings);
        setAppearance(pickAppearance(nextSettings));
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (pushVersion === settingsPushVersion.current) setAppearance(previous);
        setThemeErrorKey("settings.appearance.saveFailed");
      })
      .finally(() => {
        if (mountedRef.current) setThemeSaving(false);
      });
  };

  const handleThemeSelect = (theme: ThemePreference): void => {
    saveAppearance({ theme });
  };


  const handleFontScaleSelect = (fontScale: FontScale): void => {
    saveAppearance({ fontScale });
  };

  const handleEditorFontSelect = (editorFont: EditorFont): void => {
    saveAppearance({ editorFont });
  };

  const handleDensitySelect = (density: Density): void => {
    saveAppearance({ density });
  };


  const handleAgentProviderSelect = (nextProvider: AgentProvider): void => {
    if (
      settings === null ||
      nextProvider === settings.agentProvider ||
      agentProviderSaving
    ) {
      return;
    }

    const previousProvider = settings.agentProvider;
    const pushVersion = settingsPushVersion.current;
    setSettings((current) =>
      current === null ? current : { ...current, agentProvider: nextProvider },
    );
    setAgentProviderSaving(true);
    setAgentProviderFeedbackKey("settings.ai.engine.saving");

    void invoke("settings:set", { agentProvider: nextProvider })
      .then((nextSettings) => {
        if (!mountedRef.current) return;
        if (pushVersion === settingsPushVersion.current) setSettings(nextSettings);
        setAgentProviderFeedbackKey("settings.ai.engine.saved");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (pushVersion === settingsPushVersion.current) setSettings((current) =>
          current === null
            ? current
            : { ...current, agentProvider: previousProvider },
        );
        setAgentProviderFeedbackKey("settings.ai.engine.saveFailed");
      })
      .finally(() => {
        if (mountedRef.current) setAgentProviderSaving(false);
      });
  };

  const handleArchivedChange = (next: boolean): void => {
    setIncludeArchived(next);
    loadCourses(next);
  };

  const handleRestoreCourse = async (course: Course): Promise<void> => {
    if (pendingCourseId !== null) return;
    setPendingCourseId(course.id);
    try {
      const restored = await invoke("courses:archive", {
        courseId: course.id,
        archived: false,
      });
      if (!mountedRef.current) return;
      setCourses((current) =>
        current.map((item) => (item.id === restored.id ? restored : item)),
      );
      showToast(t("settings.courses.restored", { name: course.name }));
    } catch {
      if (mountedRef.current) {
        showToast(t("settings.courses.restoreFailed"), "danger");
      }
    } finally {
      if (mountedRef.current) setPendingCourseId(null);
    }
  };

  const runMilestoneAction = (id: MilestoneId): void => {
    setMilestonesOpen(false);
    const destination = milestoneDestination(id);
    if (destination === "settings-university" || destination === "settings-ai") {
      setActiveCategory(
        destination === "settings-university" ? "university" : "ai",
      );
      return;
    }

    onClose();
    if (destination === "course") {
      window.dispatchEvent(new CustomEvent(ADD_COURSE_SHORTCUT_EVENT));
    } else if (destination === "materials") {
      const ui = useUiStore.getState();
      if (!ui.rightRailOpen) ui.toggleRightRail();
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(IMPORT_MATERIALS_SHORTCUT_EVENT));
      });
    } else if (destination === "tour") {
      void useTourStore.getState().start();
    } else if (destination === "pip") {
      document
        .querySelector<HTMLButtonElement>(".file-video__pip:not(:disabled)")
        ?.click();
    } else {
      window.dispatchEvent(
        new CustomEvent(HELP_FOCUS_TARGET_EVENT, {
          detail: { target: destination },
        }),
      );
    }
  };

  const panel: Record<SettingsPanelId, ReactNode> = {
    tabs: <TabsSettingsPanel settings={settings} target={pendingTarget} />,
    account: <AccountPanel />,
    sync: <SyncPanel />,
    general: <GeneralPanel settings={settings} />,
    appearance: (
      <AppearancePanel
        theme={appearance.theme}
        fontScale={appearance.fontScale}
        editorFont={appearance.editorFont}
        density={appearance.density}
        saving={themeSaving}
        error={themeErrorKey === null ? null : t(themeErrorKey)}
        onSelect={handleThemeSelect}
        onSelectFontScale={handleFontScaleSelect}
        onSelectEditorFont={handleEditorFontSelect}
        onSelectDensity={handleDensitySelect}
      />
    ),
    widgets: <WidgetSettingsPanel settings={settings} />,
    packs: <PluginsCategoryPanel initialFilter={initialCategory === "mcp" ? "external" : "all"} />,
    ai: (
      <AiPanel
        provider={settings?.agentProvider ?? "claude-code"}
        providerReady={settings !== null}
        providerSaving={agentProviderSaving}
        providerFeedback={
          agentProviderFeedbackKey === null ? null : t(agentProviderFeedbackKey)
        }
        providerFeedbackError={
          agentProviderFeedbackKey === "settings.ai.engine.saveFailed"
        }
        availability={availability}
        loading={availabilityLoading}
        error={availabilityError}
        onProviderSelect={handleAgentProviderSelect}
        onRetry={loadAvailability}
      />
    ),
    assistant: <AssistantPanel settings={settings} />,
    calendar: <CalendarSettingsPanel />,
    browser: <BrowserSettingsPanel settings={settings} />,
    notifications: <NotificationsPanel settings={settings} />,
    usage: <UsagePanel />,
    shortcuts: <ShortcutsPanel settings={settings} />,
    permissions: <PermissionsPanel />,
    privacy: <PrivacyPanel />,
    advanced: <AdvancedPanel settings={settings} />,
    experimental: <ExperimentalPanel settings={settings} />,
    university: <UniversitySettingsPanel />,
    courses: (
      <CoursesPanel
        courses={courses}
        loading={coursesLoading}
        error={coursesError}
        includeArchived={includeArchived}
        pendingCourseId={pendingCourseId}
        onIncludeArchivedChange={handleArchivedChange}
        onRestore={(course) => void handleRestoreCourse(course)}
        onRetry={() => loadCourses(includeArchived)}
      />
    ),
    about: <AboutPanel />,
  } satisfies Record<SettingsPanelId, ReactNode>;

  const clearSearch = (): void => {
    setSearchInput("");
    setSettingsSearchQuery("");
  };

  return (
    <div
      className="settings-app settings-app--embedded"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }}
    >
      <div className="settings-layout">
        <aside
          className="settings-sidebar"
          aria-hidden={!leftRailOpen}
          {...{ inert: !leftRailOpen ? '' : undefined }}
          aria-label={t("settings.navigation.label")}
        >
          <button type="button" className="back-button" onClick={onClose}>
            <Icon name="arrow-left" size={17} />
            <span>{t("settings.back")}</span>
          </button>

          <label className="settings-search">
            <span className="visually-hidden">
              {t("settings.search.label")}
            </span>
            <Icon name="search" size={16} />
            <input
              ref={searchInputRef}
              type="search"
              value={searchInput}
              placeholder={t("settings.search.placeholder")}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                // Esc clears a query first; only an empty field lets Esc close settings.
                if (event.key === "Escape" && searchInput !== "") {
                  event.preventDefault();
                  event.stopPropagation();
                  clearSearch();
                }
              }}
            />
            {searchInput.length === 0 && (
              <span className="settings-search__kbd" aria-hidden="true">
                <kbd>{window.bandal?.platform === "darwin" ? "⌘" : "Ctrl"}</kbd>
                <kbd>F</kbd>
              </span>
            )}
          </label>

          {!searching && (
            <button
              type="button"
              className="settings-checklist"
              onClick={() => {
                setMilestonesOpen(true);
                void refreshMilestones(selectedCourseId);
              }}
            >
              <Icon name="checklist" />
              <span>{t("settings.checklist.label")}</span>
              <span className="settings-checklist__status">
                {milestoneProgress >= 100 ? (
                  <span role="img" aria-label={t("settings.checklist.complete")}>
                    <Icon name="check" />
                  </span>
                ) : (
                  <ProgressRing
                    compact
                    progress={milestoneProgress}
                    label={t("help.milestones.progress")}
                  />
                )}
              </span>
            </button>
          )}

          <nav className="settings-nav">
            {searching ? (
              filteredCategories.length > 0 && (
                <div className="settings-nav__group">
                  <span className="settings-nav__group-label">{t("settings.search.results")}</span>
                  {filteredCategories.map((category) =>
                    renderNavItem(category, hitsByCategory.get(category.id) ?? []),
                  )}
                </div>
              )
            ) : (
              SETTINGS_GROUPS.map((group) => {
                const groupCategories = categories.filter((category) => category.group === group);
                if (groupCategories.length === 0) return null;
                return (
                  <div className="settings-nav__group" key={group}>
                    <span className="settings-nav__group-label">
                      {t(`settings.group.${group}`)}
                    </span>
                    {groupCategories.map((category) => renderNavItem(category, []))}
                  </div>
                );
              })
            )}
            {searching && filteredCategories.length === 0 && (
              <div className="settings-nav__empty">
                <Icon name="search" size={17} />
                <span>{t("settings.search.empty")}</span>
              </div>
            )}
          </nav>

          <div className="settings-sidebar__footer">
            <BandalMark size={14} className="settings-sidebar__footer-moon" />
            <span>{t("settings.tagline")}</span>
          </div>
        </aside>

        <main ref={contentRef} className="settings-content" tabIndex={-1}>
          {!leftRailOpen && <button type="button" className="back-button settings-content__back" onClick={onClose}>
            <Icon name="arrow-left" size={17} /><span>{t("settings.back")}</span>
          </button>}
          <div className="settings-content__inner">
            {settingsLoadError && <div role="alert" className="settings-extension-feedback">
              {t('settings.appearance.loadFailed')}
              <button type="button" className="secondary-button" onClick={() => setSettingsAttempt((n) => n + 1)}>{t('settings.plugins.action.retry')}</button>
            </div>}
            {searching && filteredCategories.length === 0 ? (
              <SettingsEmptyState
                className="mt-10"
                icon={<Icon name="search" size={20} />}
                title={t("settings.search.noResults", { query: query.trim() })}
                description={t("settings.search.noResultsHint")}
                action={<Button variant="secondary" size="sm" onClick={clearSearch}>{t("settings.search.clear")}</Button>}
              />
            ) : (
              <>
                <header className="content-heading">
                  <h1>{active.label}</h1>
                  <p>{active.description}</p>
                </header>
                <SettingsSearchProvider index={searchIndex} paneMatches={paneMatches}>
                  <div className="settings-panel" key={active.id}>
                    {panel[active.id]}
                  </div>
                </SettingsSearchProvider>
              </>
            )}
          </div>
        </main>
      </div>
      <MilestonesOverlay
        open={milestonesOpen}
        selectedCourseId={selectedCourseId}
        onClose={() => setMilestonesOpen(false)}
        onTry={runMilestoneAction}
      />
      <ToastHost />
    </div>
  );

  function renderNavItem(category: Category, hits: readonly ResolvedSettingsEntry[]): JSX.Element {
    const current = activeCategory === category.id;
    return (
      <div key={category.id}>
        <button
          type="button"
          data-category={category.id}
          className={`settings-nav__item${current ? " settings-nav__item--active" : ""}`}
          aria-current={current ? "page" : undefined}
          onClick={() => navigateTo({ category: category.id })}
        >
          <Icon name={category.id} />
          <span className="settings-nav__copy">
            <span>{category.label}</span>
          </span>
        </button>
        {hits.map((hit) => (
          <button
            className="settings-search-hit"
            key={hit.id}
            type="button"
            onClick={() =>
              navigateTo({
                category: category.id,
                sectionId: hit.id,
                ...(hit.subTab !== undefined ? { subTab: hit.subTab } : {}),
              })
            }
          >
            {hit.title}
          </button>
        ))}
      </div>
    );
  }
}
