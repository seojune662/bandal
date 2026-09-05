import { DEFAULT_ORB_CHARM } from "../../../../shared/orbCharm";
import type { OrbCharmId } from "../../../../shared/orbCharm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { showToast, ToastHost } from "../../app/toast";
import {
  ADD_COURSE_SHORTCUT_EVENT,
  IMPORT_MATERIALS_SHORTCUT_EVENT,
} from "../../app/shortcuts";
import { BandalMark } from "../../components/BandalMark";
import { useLocale, useT } from "../../i18n";
import { invoke, onPush } from "../../lib/ipc";
import { useCoursesStore } from "../../stores/coursesStore";
import { useUiStore } from "../../stores/uiStore";
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  type AgentAvailability,
  type AgentProvider,
} from "../../../../shared/types/agent-events";
import type { Course } from "../../../../shared/types/course";
import {
  isSameAppearance,
  pickAppearance,
} from "../../../../shared/appearance";
import type { AppearanceSettings } from "../../../../shared/appearance";
import type { PaletteId } from "../../../../shared/theme";
import {
  isSettingsCategoryId,
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  type SettingsCategoryId,
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
  McpServersPanel,
} from "./SettingsPanels";
import { PluginsCategoryPanel } from "./PluginsCategoryPanel";
import { NotificationsPanel } from "./notifications/NotificationsPanel";
import { PermissionsPanel } from "./permissions/PermissionsPanel";
import { PrivacyPanel } from "./privacy/PrivacyPanel";
import { ShortcutsPanel } from "./shortcuts/ShortcutsPanel";
import { UsagePanel } from "./usage/UsagePanel";
import { Icon } from "./SettingsIcon";
import { searchSettings } from "./settingsSearchIndex";
import { applyTheme } from "./settingsTheme";
import { UniversitySettingsPanel } from "./UniversitySettingsPanel";
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
  id: SettingsCategoryId;
  group: SettingsGroupId;
  label: string;
  description: string;
}

interface SettingsAppProps {
  embedded?: boolean;
  onClose?: () => void;
  /** Category to open on; unknown/null falls back to General. */
  initialCategory?: string | null;
}

type ProviderState<T> = Record<AgentProvider, T>;

function connectedProvider(
  availability: AgentAvailability | null,
): boolean {
  return availability?.installed === true && availability.loggedIn;
}

export function soleConnectedProvider(
  currentProvider: AgentProvider,
  availability: Record<AgentProvider, AgentAvailability | null>,
): AgentProvider | null {
  if (AGENT_PROVIDERS.some((provider) => availability[provider] === null)) {
    return null;
  }
  if (connectedProvider(availability[currentProvider])) return null;
  const connected = AGENT_PROVIDERS.filter((provider) =>
    connectedProvider(availability[provider]),
  );
  return connected.length === 1 ? connected[0]! : null;
}

export function SettingsApp({
  embedded = false,
  onClose,
  initialCategory = null,
}: SettingsAppProps = {}): JSX.Element {
  const t = useT();
  const locale = useLocale();
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(() =>
    isSettingsCategoryId(initialCategory) ? initialCategory : "general",
  );
  const [query, setQuery] = useState("");
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    pickAppearance(DEFAULT_SETTINGS),
  );
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeErrorKey, setThemeErrorKey] = useState<string | null>(null);
  const [availability, setAvailability] = useState<
    ProviderState<AgentAvailability | null>
  >(() =>
    Object.fromEntries(
      AGENT_PROVIDERS.map((provider) => [provider, null]),
    ) as ProviderState<AgentAvailability | null>,
  );
  const [availabilityLoading, setAvailabilityLoading] = useState<
    ProviderState<boolean>
  >(() =>
    Object.fromEntries(
      AGENT_PROVIDERS.map((provider) => [provider, true]),
    ) as ProviderState<boolean>,
  );
  const [availabilityError, setAvailabilityError] = useState<
    ProviderState<string | null>
  >(() =>
    Object.fromEntries(
      AGENT_PROVIDERS.map((provider) => [provider, null]),
    ) as ProviderState<string | null>,
  );
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
  const autoProviderCheckedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId);
  const milestoneProgress = useMilestones((state) => state.progress);
  const refreshMilestones = useMilestones((state) => state.refresh);

  const categories = useMemo<readonly Category[]>(
    () =>
      SETTINGS_CATEGORIES.map(({ id, group }) => ({
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

  const searchResults = useMemo(
    () => searchSettings(query, locale),
    [locale, query],
  );
  const matchesByCategory = useMemo(
    () => new Map(searchResults.map((result) => [result.category, result.matches])),
    [searchResults],
  );
  const filteredCategories = useMemo(
    () => categories.filter((category) => matchesByCategory.has(category.id)),
    [categories, matchesByCategory],
  );

  const loadAvailability = useCallback((target?: AgentProvider): void => {
    const providers = target === undefined ? AGENT_PROVIDERS : [target];

    for (const provider of providers) {
      setAvailabilityLoading((current) => ({ ...current, [provider]: true }));
      setAvailabilityError((current) => ({ ...current, [provider]: null }));
      void invoke("agent:availability", { provider })
        .then((result) => {
          if (mountedRef.current) {
            setAvailability((current) => ({ ...current, [provider]: result }));
          }
        })
        .catch(() => {
          if (mountedRef.current) {
            setAvailabilityError((current) => ({
              ...current,
              [provider]: "availability-failed",
            }));
          }
        })
        .finally(() => {
          if (mountedRef.current) {
            setAvailabilityLoading((current) => ({
              ...current,
              [provider]: false,
            }));
          }
        });
    }
  }, []);

  const loadCourses = (showArchived: boolean): void => {
    setCoursesLoading(true);
    setCoursesError(null);
    void invoke("courses:list", { includeArchived: showArchived })
      .then((result) => {
        if (mountedRef.current) setCourses(result);
      })
      .catch(() => {
        if (mountedRef.current) setCoursesError("courses-failed");
      })
      .finally(() => {
        if (mountedRef.current) setCoursesLoading(false);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onPush("settings:changed", ({ settings: next }) => {
      setSettings(next);
      setAppearance(pickAppearance(next));
      if (!embedded) applyTheme(next);
    });

    void invoke("settings:get", {})
      .then((result) => {
        if (!mountedRef.current) return;
        setSettings(result);
        setAppearance(pickAppearance(result));
        if (!embedded) applyTheme(result);
      })
      .catch(() => {
        if (mountedRef.current) {
          setThemeErrorKey("settings.appearance.loadFailed");
        }
      });

    loadAvailability();
    loadCourses(false);

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [embedded, loadAvailability]);

  useEffect(() => {
    const refreshAvailability = (): void => loadAvailability();
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") refreshAvailability();
    };
    const unsubscribe = onPush("agent:install-progress", (progress) => {
      if (
        progress.done &&
        isAgentProvider(progress.provider)
      ) {
        loadAvailability(progress.provider);
      }
    });
    window.addEventListener("focus", refreshAvailability);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshAvailability);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadAvailability]);

  useEffect(() => {
    if (settings === null || autoProviderCheckedRef.current) return;
    if (AGENT_PROVIDERS.some((provider) => availability[provider] === null)) {
      return;
    }
    autoProviderCheckedRef.current = true;
    const previousProvider = settings.agentProvider;
    const nextProvider = soleConnectedProvider(previousProvider, availability);
    if (nextProvider === null) return;

    void invoke("settings:set", { agentProvider: nextProvider })
      .then((nextSettings) => {
        if (!mountedRef.current) return;
        setSettings(nextSettings);
        const nextKey = nextProvider === "claude-code" ? "claude" : nextProvider;
        const previousKey =
          previousProvider === "claude-code" ? "claude" : previousProvider;
        showToast(
          t("settings.ai.engine.autoSwitched", {
            provider: t(`settings.ai.${nextKey}.name`),
            unavailable: t(`settings.ai.${previousKey}.name`),
          }),
        );
      })
      .catch(() => undefined);
  }, [availability, settings, t]);

  useEffect(() => {
    if (embedded) return;
    document.documentElement.lang = locale;
    document.title = `${t("settings.app.name")} — ${t("settings.window.title")}`;
  }, [embedded, locale, t]);

  useEffect(() => {
    void refreshMilestones(selectedCourseId);
  }, [refreshMilestones, selectedCourseId]);

  useEffect(() => {
    if (embedded) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = (): void => {
      if (appearance.theme === "system") applyTheme(appearance);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [embedded, appearance]);

  /**
   * Every appearance axis saves the same way: paint optimistically, persist
   * the patch, then reconcile with whatever main actually stored (and roll
   * the whole set back on failure — a half-applied appearance is worse than
   * neither).
   */
  const saveAppearance = (patch: Partial<AppearanceSettings>): void => {
    if (themeSaving) return;
    const previous = appearance;
    const next = { ...previous, ...patch };
    if (isSameAppearance(next, previous)) return;
    setAppearance(next);
    if (!embedded) applyTheme(next);
    setThemeSaving(true);
    setThemeErrorKey(null);

    void invoke("settings:set", patch)
      .then((nextSettings) => {
        if (!mountedRef.current) return;
        setSettings(nextSettings);
        setAppearance(pickAppearance(nextSettings));
        if (!embedded) applyTheme(nextSettings);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setAppearance(previous);
        if (!embedded) applyTheme(previous);
        setThemeErrorKey("settings.appearance.saveFailed");
      })
      .finally(() => {
        if (mountedRef.current) setThemeSaving(false);
      });
  };

  const handleThemeSelect = (theme: ThemePreference): void => {
    saveAppearance({ theme });
  };

  const handlePaletteSelect = (palette: PaletteId): void => {
    saveAppearance({ palette });
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

  const handleCharmSelect = (orbCharm: OrbCharmId): void => {
    if (settings === null || orbCharm === settings.orbCharm) return;
    // The settings:changed broadcast updates both this panel and the orb.
    void invoke("settings:set", { orbCharm }).catch(() => {
      // Failure leaves the previous charm; the radio re-renders from settings.
    });
  };

  const handleAgentProviderSelect = (nextProvider: AgentProvider): void => {
    autoProviderCheckedRef.current = true;
    if (
      settings === null ||
      nextProvider === settings.agentProvider ||
      agentProviderSaving
    ) {
      return;
    }

    const previousProvider = settings.agentProvider;
    setSettings((current) =>
      current === null ? current : { ...current, agentProvider: nextProvider },
    );
    setAgentProviderSaving(true);
    setAgentProviderFeedbackKey("settings.ai.engine.saving");

    void invoke("settings:set", { agentProvider: nextProvider })
      .then((nextSettings) => {
        if (!mountedRef.current) return;
        setSettings(nextSettings);
        setAgentProviderFeedbackKey("settings.ai.engine.saved");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setSettings((current) =>
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
      showToast(
        locale === "ko-KR"
          ? `“${course.name}” 과목을 복원했어요.`
          : `Restored “${course.name}”.`,
      );
    } catch {
      if (mountedRef.current) {
        showToast(
          locale === "ko-KR"
            ? "과목을 복원하지 못했어요."
            : "Could not restore the course.",
          "danger",
        );
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

    if (embedded) onClose?.();
    else window.close();
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

  const panel = {
    account: <AccountPanel />,
    general: <GeneralPanel settings={settings} />,
    appearance: (
      <AppearancePanel
        theme={appearance.theme}
        palette={appearance.palette}
        fontScale={appearance.fontScale}
        editorFont={appearance.editorFont}
        density={appearance.density}
        orbCharm={settings?.orbCharm ?? DEFAULT_ORB_CHARM}
        charmsEnabled={settings?.experimental.orbCharms ?? true}
        saving={themeSaving}
        error={themeErrorKey === null ? null : t(themeErrorKey)}
        onSelect={handleThemeSelect}
        onSelectPalette={handlePaletteSelect}
        onSelectFontScale={handleFontScaleSelect}
        onSelectEditorFont={handleEditorFontSelect}
        onSelectDensity={handleDensitySelect}
        onSelectCharm={handleCharmSelect}
      />
    ),
    mcp: <McpServersPanel />,
    packs: <PluginsCategoryPanel />,
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
  } satisfies Record<SettingsCategoryId, ReactNode>;

  return (
    <div
      className={`settings-app${embedded ? " settings-app--embedded" : ""}`}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
      }}
    >
      {!embedded && (
        <header className="settings-titlebar titlebar-drag">
          <div className="settings-titlebar__brand">
            <BandalMark size={17} className="settings-titlebar__moon" />
            <span>{t("settings.app.name")}</span>
          </div>
          <span className="settings-titlebar__divider" aria-hidden="true" />
          <span className="settings-titlebar__label">
            {t("settings.window.title")}
          </span>
        </header>
      )}

      <div className="settings-layout">
        <aside
          className="settings-sidebar"
          aria-label={t("settings.navigation.label")}
        >
          <button
            type="button"
            className="back-button"
            onClick={() => {
              if (embedded) onClose?.();
              else window.close();
            }}
          >
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
              value={query}
              placeholder={t("settings.search.placeholder")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
            />
            {query.length === 0 && (
              <span className="settings-search__kbd" aria-hidden="true">
                <kbd>{window.bandal?.platform === "darwin" ? "⌘" : "Ctrl"}</kbd>
                <kbd>F</kbd>
              </span>
            )}
          </label>

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

          <nav className="settings-nav">
            {SETTINGS_GROUPS.map((group) => {
              const groupCategories = filteredCategories.filter(
                (category) => category.group === group,
              );
              if (groupCategories.length === 0) return null;
              return (
                <div className="settings-nav__group" key={group}>
                  <span className="settings-nav__group-label">
                    {t(`settings.group.${group}`)}
                  </span>
                  {groupCategories.map((category) => {
                    const matches = matchesByCategory.get(category.id) ?? [];
                    return (
                      <button
                        key={category.id}
                        type="button"
                        data-category={category.id}
                        className={`settings-nav__item${
                          activeCategory === category.id
                            ? " settings-nav__item--active"
                            : ""
                        }`}
                        aria-current={
                          activeCategory === category.id ? "page" : undefined
                        }
                        onClick={() => setActiveCategory(category.id)}
                      >
                        <Icon name={category.id} />
                        <span className="settings-nav__copy">
                          <span>{category.label}</span>
                          {query.trim().length > 0 && matches.length > 0 && (
                            <span className="settings-nav__hits">
                              {matches.slice(0, 3).join(" · ")}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filteredCategories.length === 0 && (
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

        <main className="settings-content" tabIndex={-1}>
          <div className="settings-content__inner">
            <header className="content-heading">
              <span className="content-heading__eyebrow">
                {t("settings.eyebrow")}
              </span>
              <h1>{active.label}</h1>
              <p>{active.description}</p>
            </header>
            <div className="settings-panel" key={active.id}>
              {panel[active.id]}
            </div>
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
}
