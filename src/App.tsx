import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Crosshair,
  Database,
  EyeOff,
  FileCode2,
  Fingerprint,
  Gamepad2,
  HardDrive,
  Info,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  MousePointer2,
  Network,
  Power,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { api, profiles } from "./lib/api";
import "./styles.css";

type View =
  "overview" | "optimizations" | "cs2" | "scanner" | "cleanup" | "recovery";
type Tweak = {
  id: string;
  title: string;
  description: string;
  category: string;
  risk: "low" | "moderate";
  recommended?: boolean;
  restart?: "none" | "signout" | "reboot";
  kind?: string;
  caveat?: string;
};
type Review = {
  kind:
    | "apply"
    | "cleanup"
    | "restore"
    | "restorePoint"
    | "cs2Apply"
    | "cs2Restore"
    | "elevate";
  ids?: string[];
  backupId?: string;
};
type Notice = { type: "success" | "error" | "info"; text: string };
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "optimizations", label: "Optimizations", icon: SlidersHorizontal },
  { id: "cs2", label: "Counter-Strike 2", icon: Crosshair },
  { id: "scanner", label: "PC scanner", icon: ScanLine },
  { id: "cleanup", label: "System cleanup", icon: HardDrive },
  { id: "recovery", label: "Recovery", icon: RotateCcw },
] as const;
const categories = [
  { id: "all", label: "All tweaks", icon: Layers3 },
  { id: "gaming", label: "Gaming", icon: Gamepad2 },
  { id: "input", label: "Input & latency", icon: MousePointer2 },
  { id: "graphics", label: "Graphics", icon: Monitor },
  { id: "network", label: "Network", icon: Network },
  { id: "windows", label: "Windows", icon: LayoutDashboard },
  { id: "privacy", label: "Privacy", icon: EyeOff },
  { id: "power", label: "Power", icon: Power },
];
const categoryLabel = (id: string) =>
  categories.find((c) => c.id === id)?.label || id;
const unwrap = (v: any) => v?.data ?? v;
const checkedResult = (v: any) => {
  if (v?.ok === false)
    throw new Error(
      v.error || v.message || "The operation could not be completed.",
    );
  return unwrap(v);
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const bytes = (value: number = 0) => {
  if (!value) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** unit).toFixed(unit > 1 ? 2 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
};
const when = (value: string) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

function App() {
  const [view, setView] = useState<View>("overview");
  const [runtime, setRuntime] = useState<any>({
    mode: "preview",
    isAdmin: false,
    appliedIds: [],
    history: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [tweaks, setTweaks] = useState<Tweak[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("all");
  const [scan, setScan] = useState<any>(null);
  const [cleanup, setCleanup] = useState<any>(null);
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(
    new Set(),
  );
  const [cs2, setCs2] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [consent, setConsent] = useState(false);
  const windows = runtime.mode === "windows";
  const appliedIds: string[] = runtime.appliedIds || [];
  const history: any[] = runtime.history || [];
  const recommended = tweaks.filter(
    (t) => t.recommended && !appliedIds.includes(t.id),
  );
  const activeTweaks = tweaks.filter(
    (t) => selected.has(t.id) && !appliedIds.includes(t.id),
  );
  const shownTweaks = useMemo(
    () =>
      tweaks.filter(
        (t) =>
          (category === "all" || t.category === category) &&
          (risk === "all" || t.risk === risk) &&
          `${t.title} ${t.description} ${t.category}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [tweaks, category, risk, query],
  );
  const cleanupCategories: any[] = cleanup?.categories || [];
  const cleanupBytes = cleanupCategories
    .filter((c) => cleanupSelected.has(c.id))
    .reduce((n, c) => n + (c.bytes || 0), 0);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.getState(), api.listTweaks()]).then((results) => {
      if (!alive) return;
      if (results[0].status === "fulfilled" && results[0].value?.ok !== false)
        setRuntime(unwrap(results[0].value)?.state || unwrap(results[0].value));
      else if (results[0].status === "fulfilled")
        setNotice({
          type: "error",
          text:
            results[0].value?.error ||
            "Could not read app status. Relaunch FRAMEFORGE and try again.",
        });
      else
        setNotice({
          type: "error",
          text: `Could not read app status: ${errorText(results[0].reason)}`,
        });
      if (results[1].status === "fulfilled") {
        const value = unwrap(results[1].value);
        const list = Array.isArray(value) ? value : value?.tweaks || [];
        setTweaks(list);
        setSelected(
          new Set(
            list.filter((t: Tweak) => t.recommended).map((t: Tweak) => t.id),
          ),
        );
      } else
        setNotice({
          type: "error",
          text: `Could not load optimizations: ${errorText(results[1].reason)}`,
        });
      setLoaded(true);
    });
    const off = api.onProgress((event: any) => {
      if (alive)
        setProgress(
          typeof event === "string"
            ? event
            : event?.message || event?.status || "Working on your system…",
        );
    });
    return () => {
      alive = false;
      if (typeof off === "function") off();
    };
  }, []);

  useEffect(() => {
    if (review) setConsent(false);
  }, [review]);
  useEffect(() => {
    if (!review) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".review-modal button:not(:disabled)")
        ?.focus(),
    );
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.review-modal button:not(:disabled), .review-modal input:not(:disabled), .review-modal [tabindex="0"]',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, [review]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setReview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  async function refreshState() {
    const value = checkedResult(await api.getState());
    setRuntime(value.state || value);
  }
  async function runRead(kind: "scan" | "cleanup" | "cs2") {
    setBusy(kind);
    setProgress("");
    setNotice(null);
    try {
      const result = checkedResult(
        await (kind === "scan"
          ? api.scan()
          : kind === "cleanup"
            ? api.analyzeCleanup()
            : api.cs2Scan()),
      );
      if (result?.preview) {
        setNotice({
          type: "info",
          text: "Open the Windows desktop app to read your PC. This browser preview never invents hardware or system results.",
        });
        return;
      }
      if (kind === "scan") setScan(result.scan || result);
      if (kind === "cleanup") {
        setCleanup(result);
        setCleanupSelected(
          new Set(
            (result.categories || [])
              .filter((c: any) => c.bytes > 0)
              .map((c: any) => c.id),
          ),
        );
      }
      if (kind === "cs2") setCs2(result);
      setNotice({
        type: "success",
        text:
          kind === "scan"
            ? "Hardware scan complete. These specifications were read from your PC."
            : kind === "cleanup"
              ? "Analysis complete. Review the files before cleaning."
              : result.installed || result.found
                ? "Counter-Strike 2 detected."
                : "Counter-Strike 2 was not found in the standard Steam libraries.",
      });
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  }
  async function confirmOperation() {
    if (!review || !windows || !consent) return;
    setBusy("mutation");
    setProgress("Preparing your operation…");
    setNotice(null);
    try {
      let result: any;
      if (review.kind === "apply")
        result = await api.applyTweaks(review.ids || [], {
          approved: true,
          createRestorePoint: true,
        });
      else if (review.kind === "cleanup")
        result = await api.clean(review.ids || [], { approved: true });
      else if (review.kind === "restore")
        result = await api.restoreBackup(review.backupId || "", {
          approved: true,
        });
      else if (review.kind === "restorePoint")
        result = await api.createRestorePoint({ approved: true });
      else if (review.kind === "cs2Apply")
        result = await api.cs2Apply({ approved: true });
      else if (review.kind === "cs2Restore")
        result = await api.cs2Restore({ approved: true });
      else result = await api.elevate({ approved: true });
      const value = checkedResult(result);
      const kind = review.kind;
      if (kind === "apply") setSelected(new Set());
      await refreshState();
      setReview(null);
      const changedCount =
        value.changedCount ??
        value.appliedIds?.length ??
        value.applied?.length ??
        0;
      const skipped = Array.isArray(value.skipped) ? value.skipped : [];
      const skipDetails = skipped.length
        ? ` ${skipped.length} skipped: ${skipped.map((item: any) => `${tweaks.find((t) => t.id === item.id)?.title || item.id}: ${item.reason || "Unavailable"}`).join("; ")}.`
        : "";
      const applyMessage =
        changedCount > 0
          ? `${changedCount} tweaks applied. Review the saved settings backup in Recovery. Sign out or restart for settings marked accordingly.${skipDetails}`
          : `No settings changed.${skipDetails || " Your settings already match, or no selected settings are available on this Windows build."}`;
      setNotice({
        type: "success",
        text:
          kind === "apply"
            ? applyMessage
            : value.message ||
              (kind === "cleanup"
                ? `Cleaned ${bytes(value.bytesRemoved)}. ${value.filesRemoved || 0} files removed; ${value.skipped || 0} locked or unavailable files skipped.`
                : kind === "restore" || kind === "cs2Restore"
                  ? "Your saved settings have been restored."
                  : kind === "restorePoint"
                    ? "Windows restore point created successfully."
                    : kind === "elevate"
                      ? "Administrator relaunch requested. Approve the Windows UAC prompt to continue in the new window."
                      : "The managed CS2 configuration has been saved."),
      });
      if (kind === "cleanup") {
        setCleanup(null);
        setCleanupSelected(new Set());
      }
      if (kind === "cs2Apply" || kind === "cs2Restore") {
        const fresh = checkedResult(await api.cs2Scan());
        setCs2(fresh);
      }
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
      setReview(null);
      try {
        await refreshState();
      } catch {
        /* Keep the original operation error visible. */
      }
    } finally {
      setBusy(null);
      setProgress("");
    }
  }
  const toggleTweak = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const openReview = (value: Review) => {
    setNotice(null);
    setReview(value);
  };
  const selectProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setSelected(
      new Set(profile.ids.filter((tid) => !appliedIds.includes(tid))),
    );
    setCategory("all");
    setQuery("");
    setRisk("all");
    setView("optimizations");
  };
  const selectRecommended = () => {
    setSelected(new Set(recommended.map((t) => t.id)));
    setCategory("all");
    setQuery("");
    setRisk("all");
    setView("optimizations");
  };

  function TweakCard({
    tweak,
    compact = false,
  }: {
    tweak: Tweak;
    compact?: boolean;
  }) {
    const Icon = categories.find((c) => c.id === tweak.category)?.icon || Zap;
    const applied = appliedIds.includes(tweak.id);
    return (
      <label
        className={`tweak-card ${selected.has(tweak.id) ? "selected" : ""} ${compact ? "compact" : ""}`}
      >
        <input
          type="checkbox"
          checked={selected.has(tweak.id)}
          onChange={() => toggleTweak(tweak.id)}
          disabled={!!busy || applied}
          aria-label={`Select ${tweak.title}`}
        />
        <div className="tweak-card-top">
          <span className={`tweak-icon ${tweak.category}`}>
            <Icon size={20} strokeWidth={1.7} />
          </span>
          <span className="check-box">
            {selected.has(tweak.id) && <Check size={13} strokeWidth={3} />}
          </span>
        </div>
        <div className="tweak-meta">
          {categoryLabel(tweak.category)}
          {tweak.recommended && (
            <span
              className="recommended-dot"
              title="Recommended for this profile"
            />
          )}
        </div>
        <h3>{tweak.title}</h3>
        <p>{tweak.description}</p>
        {tweak.caveat && !compact && (
          <div className="tweak-caveat">
            <Info size={12} />
            {tweak.caveat}
          </div>
        )}
        <div className="tweak-card-bottom">
          <span className={`risk-tag ${tweak.risk}`}>
            <span />
            {tweak.risk === "low" ? "Low risk" : "Review trade-off"}
          </span>
          {applied ? (
            <span className="applied-label">
              <Check size={12} />
              Applied
            </span>
          ) : tweak.restart && tweak.restart !== "none" ? (
            <span className="restart-label">
              <RotateCcw size={11} />
              {tweak.restart === "reboot" ? "Restart" : "Sign out"}
            </span>
          ) : (
            <span className="restart-label">No restart</span>
          )}
        </div>
      </label>
    );
  }

  function Overview() {
    return (
      <>
        <section className="hero-panel">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="little-line" />
              LESS FRICTION. MORE FOCUS.
            </div>
            <h1>
              Less latency.
              <br />
              <span>More game.</span>
            </h1>
            <p>
              A sharper setup for your next match. Fine-tune Windows,
              <br className="desktop-break" /> clean the clutter, and give your
              hardware room to play.
            </p>
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => selectProfile("cs2")}
              >
                <Zap size={16} />
                Optimize your setup
                <ArrowUpRight size={16} />
              </button>
              <button
                className="hero-secondary"
                onClick={() => {
                  setView("scanner");
                  void runRead("scan");
                }}
              >
                Scan my PC
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={13} />
              Your settings. Backed up before changes.
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="orbit-dash" />
            <span className="orbit-dot dot-one" />
            <span className="orbit-dot dot-two" />
            <span className="orbit-plus plus-one">+</span>
            <span className="orbit-plus plus-two">+</span>
            <div className="art-crosshair">
              <Crosshair strokeWidth={0.65} />
              <div className="crosshair-center" />
            </div>
            <div className="art-label label-one">
              <span />
              PRECISION, REFINED.
            </div>
            <div className="art-label label-two">
              BUILT FOR THE COMPETITIVE EDGE
            </div>
          </div>
          <span className="hero-index">01 / THE PERFORMANCE LAB</span>
        </section>
        <div className="section-heading hardware-heading">
          <div>
            <span className="eyebrow muted">
              THE BUILD WE’RE OPTIMIZING FOR
            </span>
            <h2>Your hardware. Your advantage.</h2>
          </div>
          <span className="subtle-pill">
            <span />
            Target build · not a live scan
          </span>
        </div>
        <div className="hardware-grid">
          <div className="hardware-card">
            <div className="hardware-icon">
              <Cpu size={24} strokeWidth={1.4} />
            </div>
            <div>
              <span className="hardware-type">PROCESSOR</span>
              <h3>Intel Core i5-14600</h3>
              <p>Performance + efficiency, in balance.</p>
            </div>
            <ArrowUpRight size={16} className="hardware-arrow" />
          </div>
          <div className="hardware-card">
            <div className="hardware-icon purple">
              <Monitor size={24} strokeWidth={1.4} />
            </div>
            <div>
              <span className="hardware-type">GRAPHICS CARD</span>
              <h3>NVIDIA RTX 3060</h3>
              <p>Made for smooth, focused play.</p>
            </div>
            <ArrowUpRight size={16} className="hardware-arrow" />
          </div>
          <div className="hardware-card">
            <div className="hardware-icon blue">
              <Database size={24} strokeWidth={1.4} />
            </div>
            <div>
              <span className="hardware-type">MEMORY</span>
              <h3>32 GB RAM</h3>
              <p>Headroom for the way you game.</p>
            </div>
            <ArrowUpRight size={16} className="hardware-arrow" />
          </div>
        </div>
        <div className="overview-middle">
          <section className="profile-panel">
            <div className="panel-heading">
              <div className="small-icon">
                <Crosshair size={19} />
              </div>
              <span>YOUR PERFORMANCE PROFILE</span>
              <span className="badge cyan">CS2 FOCUSED</span>
            </div>
            <h2>Every millisecond matters.</h2>
            <p>
              A curated starting point for competitive gaming.
              <br />
              Review each change, then apply what fits your setup.
            </p>
            <div className="profile-stats">
              <div>
                <strong>{loaded ? tweaks.length : "—"}</strong>
                <span>free optimizations</span>
              </div>
              <div>
                <strong>{appliedIds.length.toString().padStart(2, "0")}</strong>
                <span>currently applied</span>
              </div>
              <div>
                <strong>
                  100<span>%</span>
                </strong>
                <span>in your control</span>
              </div>
            </div>
            <button className="text-link" onClick={() => selectProfile("cs2")}>
              Review CS2 focus profile
              <ArrowRight size={15} />
            </button>
            <div className="profile-watermark" aria-hidden="true">
              <Activity />
            </div>
          </section>
          <section className="getting-started">
            <div className="panel-title-row">
              <h3>A better setup starts here</h3>
              <span className="soft-text">3 simple steps</span>
            </div>
            <div className="setup-step">
              <span className={`step-number ${scan ? "done" : ""}`}>
                {scan ? <Check size={14} /> : "01"}
              </span>
              <div>
                <h4>Get to know your PC</h4>
                <p>Read your exact hardware and Windows build.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Open PC scanner"
                onClick={() => setView("scanner")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="setup-step">
              <span className="step-number">02</span>
              <div>
                <h4>Make it your own</h4>
                <p>Choose tweaks for how you play.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Choose optimizations"
                onClick={() => setView("optimizations")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="setup-step">
              <span className={`step-number ${history.length ? "done" : ""}`}>
                {history.length ? <Check size={14} /> : "03"}
              </span>
              <div>
                <h4>Apply with peace of mind</h4>
                <p>Review, back up, and approve your changes.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Open Recovery"
                onClick={() => setView("recovery")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
          </section>
        </div>
        <div className="section-heading">
          <div>
            <h2>Small changes. Smoother sessions.</h2>
            <p>A few picks from your optimization toolkit.</p>
          </div>
          <button
            className="text-link"
            onClick={() => setView("optimizations")}
          >
            View all tweaks
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="tweak-grid overview-tweaks">
          {(recommended.length ? recommended : tweaks).slice(0, 3).map((t) => (
            <div className="tweak-card-wrap" key={t.id}>
              {TweakCard({ tweak: t, compact: true })}
            </div>
          ))}
        </div>
        {!tweaks.length && loaded && (
          <div className="empty-state mini">
            <Info size={22} />
            <p>No tweaks are available. Check the app connection and reload.</p>
          </div>
        )}
        <div className="bottom-note">
          <ShieldCheck size={15} />
          <span>
            No subscriptions. No magic FPS promises. Just transparent,
            reversible changes.
          </span>
          <span className="version-label">FRAMEFORGE / 1.0</span>
        </div>
      </>
    );
  }

  function Optimizations() {
    return (
      <>
        <PageIntro
          eyebrow="THE PERFORMANCE TOOLKIT"
          title="Fine-tune your advantage."
          description="Real Windows settings, clear trade-offs, and the final say on every change."
          icon={SlidersHorizontal}
        />
        <div className="optimization-summary">
          <div>
            <span className="summary-icon">
              <Zap size={20} />
            </span>
            <div>
              <strong>{tweaks.length} free tweaks. Zero guesswork.</strong>
              <p>
                Built around gaming, input response, and a lighter Windows
                experience.
              </p>
            </div>
          </div>
          <button className="button secondary" onClick={selectRecommended}>
            <Sparkles size={15} />
            Select recommended
          </button>
        </div>
        <div className="profile-choices">
          <span>START WITH A PROFILE</span>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => selectProfile(profile.id)}
              title={profile.description}
            >
              <Crosshair size={13} />
              {profile.name}
              <span>{profile.ids.length} tweaks</span>
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
        <div className="category-tabs">
          {categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? "active" : ""}
              onClick={() => setCategory(c.id)}
            >
              <c.icon size={15} />
              {c.label}
              <span>
                {c.id === "all"
                  ? tweaks.length
                  : tweaks.filter((t) => t.category === c.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="Search optimizations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search optimizations"
            />
            {query && (
              <button
                className="icon-button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            aria-label="Filter by risk"
          >
            <option value="all">All risk levels</option>
            <option value="low">Low risk</option>
            <option value="moderate">Review trade-offs</option>
          </select>
          <span className="results-count">{shownTweaks.length} tweaks</span>
        </div>
        <div className="tweak-grid">
          {shownTweaks.map((t) => (
            <div className="tweak-card-wrap" key={t.id}>
              {TweakCard({ tweak: t })}
            </div>
          ))}
        </div>
        {!shownTweaks.length && (
          <Empty
            icon={Search}
            title="No matching tweaks"
            text="Try another search or category."
          />
        )}
        <div className="selection-bar">
          <div className="selection-count">
            <span>{activeTweaks.length}</span>
            <div>
              <strong>Tweaks selected</strong>
              <p>You’ll review and approve before anything changes.</p>
            </div>
          </div>
          <div className="selection-actions">
            <button
              className="text-button"
              onClick={() => setSelected(new Set())}
              disabled={!selected.size}
            >
              Clear selection
            </button>
            <button
              className="button primary"
              disabled={!activeTweaks.length || !!busy}
              onClick={() =>
                openReview({
                  kind: "apply",
                  ids: activeTweaks.map((t) => t.id),
                })
              }
            >
              Review & apply
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </>
    );
  }

  function Scanner() {
    return (
      <>
        <PageIntro
          eyebrow="KNOW WHAT YOU’RE PLAYING WITH"
          title="Your PC, under the lens."
          description="Actual hardware specifications, read locally from your Windows PC."
          icon={ScanLine}
        />
        <div className="scanner-banner">
          <div className="scanner-graphic">
            <ScanLine size={42} strokeWidth={1} />
            <span />
          </div>
          <div>
            <span className="eyebrow muted">LOCAL HARDWARE SCAN</span>
            <h2>
              {scan
                ? "The details behind your setup."
                : "Meet the machine behind your game."}
            </h2>
            <p>
              {scan
                ? `Last scan: ${when(scan.timestamp)}`
                : "Discover your CPU, GPU, memory, storage, and Windows build. Your hardware information stays on this PC."}
            </p>
          </div>
          <button
            className="button primary"
            disabled={!!busy}
            onClick={() => void runRead("scan")}
          >
            {busy === "scan" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ScanLine size={16} />
            )}
            {busy === "scan" ? "Scanning…" : scan ? "Scan again" : "Scan my PC"}
          </button>
        </div>
        {!scan ? (
          <div className="scan-placeholder-grid">
            {[
              {
                icon: Cpu,
                title: "Processor",
                text: "Model, cores, and threads",
              },
              {
                icon: Monitor,
                title: "Graphics",
                text: "GPU model and video memory",
              },
              {
                icon: Database,
                title: "Memory",
                text: "Capacity, speed, and modules",
              },
              {
                icon: HardDrive,
                title: "Storage & system",
                text: "Disks, firmware, and Windows",
              },
            ].map((item) => (
              <div className="scan-placeholder" key={item.title}>
                <item.icon size={25} strokeWidth={1.4} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span>Waiting for scan</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="scan-result-grid">
              <SpecCard
                icon={Cpu}
                title="Processor"
                name={scan.cpu?.name || "Not reported"}
                rows={[
                  ["Cores", scan.cpu?.cores],
                  ["Threads", scan.cpu?.threads],
                ]}
              />
              <SpecCard
                icon={Monitor}
                title="Graphics"
                name={scan.gpu?.[0]?.name || "Not reported"}
                rows={[
                  [
                    "Video memory",
                    scan.gpu?.[0]?.vramGB
                      ? `${scan.gpu[0].vramGB} GB`
                      : "Not reported",
                  ],
                  ["Adapters", scan.gpu?.length],
                ]}
              />
              <SpecCard
                icon={Database}
                title="Memory"
                name={
                  scan.memory?.totalGB
                    ? `${scan.memory.totalGB} GB installed`
                    : "Not reported"
                }
                rows={[
                  [
                    "Speed",
                    scan.memory?.speedMHz
                      ? `${scan.memory.speedMHz} MHz`
                      : "Not reported",
                  ],
                  ["Modules", scan.memory?.modules?.length],
                ]}
              />
              <SpecCard
                icon={LayoutDashboard}
                title="Operating system"
                name={scan.os?.name || "Not reported"}
                rows={[
                  ["Build", scan.os?.build],
                  [
                    "Privileges",
                    runtime.isAdmin ? "Administrator" : "Standard user",
                  ],
                ]}
              />
            </div>
            <section className="surface details-panel">
              <div className="panel-title-row">
                <h3>Under the hood</h3>
                <Fingerprint size={19} />
              </div>
              <div className="details-rows">
                <Detail
                  label="Motherboard"
                  value={
                    [scan.motherboard?.manufacturer, scan.motherboard?.product]
                      .filter(Boolean)
                      .join(" ") || "Not reported"
                  }
                />
                <Detail
                  label="BIOS"
                  value={scan.bios?.version || "Not reported"}
                />
                {(scan.gpu || []).map((g: any, i: number) => (
                  <Detail
                    key={`driver-${i}`}
                    label={`GPU ${i + 1} driver`}
                    value={[
                      g.driverVersion || "Not reported",
                      g.vramSource ? `VRAM: ${g.vramSource}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
                {(scan.memory?.modules || []).map((m: any, i: number) => (
                  <Detail
                    key={`dimm-${i}`}
                    label={m.slot || `RAM module ${i + 1}`}
                    value={
                      [
                        m.manufacturer,
                        m.partNumber,
                        m.capacityBytes ? bytes(m.capacityBytes) : "",
                        m.configuredSpeedMhz || m.speedMhz
                          ? `${m.configuredSpeedMhz || m.speedMhz} MHz`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Detected module"
                    }
                  />
                ))}
                {(scan.gpu || []).slice(1).map((g: any, i: number) => (
                  <Detail
                    key={i}
                    label={`Graphics adapter ${i + 2}`}
                    value={g.name}
                  />
                ))}
                {(scan.disks || []).map((d: any, i: number) => (
                  <Detail
                    key={`disk-${i}`}
                    label={`Storage ${i + 1}`}
                    value={[
                      d.model || d.name || d.friendlyName,
                      d.sizeGB ? `${d.sizeGB} GB` : d.size ? bytes(d.size) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
                {(scan.network || []).map((n: any, i: number) => (
                  <Detail
                    key={`net-${i}`}
                    label={`Network ${i + 1}`}
                    value={
                      n.name ||
                      n.description ||
                      n.interfaceDescription ||
                      "Detected adapter"
                    }
                  />
                ))}
                {(scan.monitor || []).map((m: any, i: number) => (
                  <Detail
                    key={`monitor-${i}`}
                    label={`Display ${i + 1}`}
                    value={
                      [
                        m.name || m.model,
                        m.width && m.height ? `${m.width} × ${m.height}` : "",
                        m.refreshRate ? `${m.refreshRate} Hz` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Detected display"
                    }
                  />
                ))}
              </div>
            </section>
          </>
        )}
        <div className="info-strip">
          <LockKeyhole size={17} />
          <span>
            Private by design. The scanner reads hardware details locally and
            does not upload them.
          </span>
        </div>
      </>
    );
  }

  function Cleanup() {
    return (
      <>
        <PageIntro
          eyebrow="MAKE ROOM FOR WHAT MATTERS"
          title="Less clutter. More breathing room."
          description="Find temporary files and caches, preview the space, and approve what goes."
          icon={HardDrive}
        />
        <div className="cleanup-layout">
          <section className="surface cleanup-main">
            <div className="cleanup-visual">
              <div className="cleanup-ring">
                <HardDrive size={37} strokeWidth={1.2} />
              </div>
              <div className="cleanup-orbit" />
            </div>
            <span className="eyebrow muted">
              {cleanup ? "READY FOR YOUR REVIEW" : "A FRESH START"}
            </span>
            <h2>
              {cleanup
                ? bytes(
                    cleanup.totalBytes ||
                      cleanupCategories.reduce((n, c) => n + (c.bytes || 0), 0),
                  )
                : "Find the unnecessary."}
            </h2>
            <p>
              {cleanup
                ? "of removable files found on your PC."
                : "Scan supported temporary folders. No personal documents, game saves, or Downloads."}
            </p>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void runRead("cleanup")}
            >
              {busy === "cleanup" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Search size={16} />
              )}
              {busy === "cleanup"
                ? "Analyzing…"
                : cleanup
                  ? "Analyze again"
                  : "Analyze my PC"}
            </button>
            <span className="cleanup-foot">
              <ShieldCheck size={13} />
              Analysis never deletes files.
            </span>
          </section>
          <section className="surface cleanup-categories">
            <div className="panel-title-row">
              <h3>{cleanup ? "Choose what to clean" : "A thoughtful clean"}</h3>
              <Trash2 size={17} />
            </div>
            {cleanup ? (
              <>
                {cleanupCategories.map((c) => (
                  <label
                    className={`cleanup-row ${cleanupSelected.has(c.id) ? "checked" : ""}`}
                    key={c.id}
                  >
                    <input
                      type="checkbox"
                      checked={cleanupSelected.has(c.id)}
                      disabled={!!busy || c.bytes === 0}
                      onChange={() =>
                        setCleanupSelected((prev) => {
                          const next = new Set(prev);
                          next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                          return next;
                        })
                      }
                    />
                    <span className="check-box">
                      {cleanupSelected.has(c.id) && <Check size={12} />}
                    </span>
                    <div>
                      <h4>{c.title}</h4>
                      <p>{(c.fileCount || 0).toLocaleString()} files</p>
                    </div>
                    <strong>{bytes(c.bytes)}</strong>
                  </label>
                ))}
                {!cleanupCategories.length && (
                  <p className="soft-text">No removable files found.</p>
                )}
                <div className="cleanup-total">
                  <span>Selected space</span>
                  <strong>{bytes(cleanupBytes)}</strong>
                </div>
                <button
                  className="button primary full-width"
                  disabled={
                    !cleanupSelected.size || cleanupBytes <= 0 || !!busy
                  }
                  onClick={() =>
                    openReview({ kind: "cleanup", ids: [...cleanupSelected] })
                  }
                >
                  <Trash2 size={15} />
                  Review & clean
                </button>
              </>
            ) : (
              <div className="cleanup-explainer">
                {[
                  {
                    icon: Clock3,
                    title: "Temporary files",
                    text: "Leftovers in supported Windows and user temp folders.",
                  },
                  {
                    icon: Layers3,
                    title: "A 48-hour buffer",
                    text: "Only temporary files at least 48 hours old are eligible. Locked files are skipped.",
                  },
                  {
                    icon: ShieldCheck,
                    title: "You approve every clean",
                    text: "See categories and file sizes before removing anything.",
                  },
                ].map((item) => (
                  <div key={item.title}>
                    <span>
                      <item.icon size={19} />
                    </span>
                    <div>
                      <h4>{item.title}</h4>
                      <p>{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <div className="warning-strip">
          <Info size={17} />
          <span>
            Cleanup frees storage; results vary. Only temporary files older than
            48 hours are eligible. Locked files are skipped. Deleted files
            cannot be restored from a settings backup.
          </span>
        </div>
      </>
    );
  }

  function CS2() {
    return (
      <>
        <PageIntro
          eyebrow="BUILT FOR THE NEXT ROUND"
          title="Your Counter-Strike edge."
          description="A focused, managed CS2 config — without outdated launch options or made-up FPS gains."
          icon={Crosshair}
        />
        <section className="cs2-hero">
          <div>
            <span className="badge cyan">
              <Crosshair size={12} />
              COUNTER-STRIKE 2
            </span>
            <h2>
              Keep your head
              <br />
              in the game.
            </h2>
            <p>
              Make supported game preferences consistent.
              <br />
              Keep your existing autoexec safe.
            </p>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void runRead("cs2")}
            >
              {busy === "cs2" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Search size={16} />
              )}
              {busy === "cs2"
                ? "Finding game…"
                : cs2
                  ? "Check installation again"
                  : "Find my CS2 installation"}
            </button>
          </div>
          <div className="cs2-art" aria-hidden="true">
            <span className="cs2-huge">
              CS<span>2</span>
            </span>
            <div className="cs2-cross">
              <Crosshair size={250} strokeWidth={0.4} />
            </div>
            <span className="cs2-coordinates">
              PRECISION / CONSISTENCY / CONTROL
            </span>
          </div>
        </section>
        <div className="cs2-feature-grid">
          <Feature
            icon={MousePointer2}
            title="Consistent input"
            text="Windows pointer and input tweaks live in the Input & latency toolkit, each with a clear description."
          />
          <Feature
            icon={FileCode2}
            title="Managed configuration"
            text="A small supported autoexec block, with the exact settings shown before approval."
          />
          <Feature
            icon={RotateCcw}
            title="Keep your original"
            text="Your existing config is backed up before editing. Restore the original from this page."
          />
        </div>
        <section className="surface cs2-config">
          <div className="panel-title-row">
            <div>
              <h3>Managed autoexec</h3>
              <p className="soft-text">
                Detected through your local Steam libraries.
              </p>
            </div>
            <span
              className={`badge ${cs2?.installed || cs2?.found ? "cyan" : ""}`}
            >
              {cs2
                ? cs2.installed || cs2.found
                  ? "GAME DETECTED"
                  : "NOT DETECTED"
                : "NOT SCANNED"}
            </span>
          </div>
          {cs2 && (cs2.installed || cs2.found) ? (
            <>
              <div className="config-path">
                <FileCode2 size={17} />
                <code>{cs2.autoexecPath || cs2.installPath}</code>
              </div>
              <p className="cs2-config-copy">
                {cs2.managed
                  ? "FRAMEFORGE settings are present in your autoexec."
                  : "Ready to add a managed block to your autoexec. The rest of your existing config is preserved."}
              </p>
              <div className="config-buttons">
                <button
                  className="button primary"
                  disabled={!!busy || !!cs2.managed}
                  onClick={() => openReview({ kind: "cs2Apply" })}
                >
                  <FileCode2 size={15} />
                  {cs2.managed
                    ? "Config already applied"
                    : "Review & apply config"}
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy || !cs2.managed}
                  onClick={() => openReview({ kind: "cs2Restore" })}
                >
                  <RotateCcw size={15} />
                  Restore original config
                </button>
              </div>
            </>
          ) : (
            <div className="config-empty">
              <FileCode2 size={28} strokeWidth={1.3} />
              <p>
                {cs2
                  ? "CS2 was not found. Install the game through Steam, then scan again."
                  : "Scan your installation to see the config location and available actions."}
              </p>
            </div>
          )}
        </section>
        <div className="info-strip">
          <Info size={17} />
          <span>
            No timer hacks, security disabling, or “zero latency” promises.
            Frame time and input delay also depend on your display, peripherals,
            drivers, and in-game settings.
          </span>
        </div>
      </>
    );
  }

  function Recovery() {
    return (
      <>
        <PageIntro
          eyebrow="A WAY BACK, BUILT IN"
          title="Try it. Keep a way back."
          description="Settings backups and Windows restore points make changes easier to review and reverse."
          icon={RotateCcw}
        />
        <div className="recovery-grid">
          <section className="surface protection-card">
            <span className="protection-icon">
              <ShieldCheck size={30} strokeWidth={1.2} />
            </span>
            <span className="eyebrow muted">WINDOWS SYSTEM PROTECTION</span>
            <h2>A checkpoint before change.</h2>
            <p>
              Before changing a tweak, FRAMEFORGE requires a Windows restore
              point and a backup of the exact settings being changed. If
              protection is unavailable, the operation stops.
            </p>
            <div className="protection-status">
              <span
                className={`status-dot ${windows && runtime.restoreAvailable ? "green" : "amber"}`}
              />
              {!windows
                ? "Available in the Windows desktop app"
                : runtime.restoreAvailable
                  ? "System Protection is available"
                  : "System Protection needs verification"}
            </div>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => openReview({ kind: "restorePoint" })}
            >
              <ShieldCheck size={15} />
              Create restore point
            </button>
          </section>
          <section className="surface recovery-explainer">
            <div className="panel-title-row">
              <h3>Two layers of peace of mind</h3>
              <Layers3 size={18} />
            </div>
            <div className="recovery-info">
              <span>01</span>
              <div>
                <h4>Exact settings backup</h4>
                <p>
                  Restore the original registry values and power settings
                  captured before a tweak batch. No guesswork about your custom
                  Windows defaults.
                </p>
              </div>
            </div>
            <div className="recovery-info">
              <span>02</span>
              <div>
                <h4>Windows restore point</h4>
                <p>
                  A broader system checkpoint created by Windows. Full system
                  recovery uses the Windows System Restore interface.
                </p>
              </div>
            </div>
            <div className="small-warning">
              <Info size={15} />
              <span>
                Settings recovery does not recover permanently deleted cleanup
                files.
              </span>
            </div>
          </section>
        </div>
        <section className="surface history-panel">
          <div className="panel-title-row">
            <div>
              <h3>Settings backup history</h3>
              <p className="soft-text">
                Your original settings, saved before changes.
              </p>
            </div>
            <span className="subtle-pill">
              {history.length} {history.length === 1 ? "backup" : "backups"}
            </span>
          </div>
          {history.length ? (
            <div className="history-list">
              {history.map((item) => (
                <div className="history-row" key={item.id}>
                  <span className="history-icon">
                    <RotateCcw size={19} />
                  </span>
                  <div className="history-row-info">
                    <h4>{item.label || "Optimization settings backup"}</h4>
                    <p>
                      {when(item.createdAt)} ·{" "}
                      {item.count ?? item.tweakIds?.length ?? 0} tweaks
                    </p>
                  </div>
                  <span
                    className={`history-status ${item.status === "restored" || item.restoredAt ? "restored" : ""}`}
                  >
                    {item.status === "restored" || item.restoredAt
                      ? "Restored"
                      : item.status === "failed"
                        ? "Needs review"
                        : "Saved"}
                  </span>
                  <button
                    className="button secondary small"
                    disabled={
                      !!busy || item.status === "restored" || !!item.restoredAt
                    }
                    onClick={() =>
                      openReview({ kind: "restore", backupId: item.id })
                    }
                  >
                    <RotateCcw size={13} />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={Clock3}
              title="Your changes will have a history."
              text="Apply your first set of tweaks and its settings backup will appear here."
            />
          )}
        </section>
      </>
    );
  }

  const reviewTitles: Record<Review["kind"], string> = {
    apply: "Your tweaks. Your approval.",
    cleanup: "Review your system clean.",
    restore: "Restore your previous settings?",
    restorePoint: "Create a Windows checkpoint?",
    cs2Apply: "Review your CS2 configuration.",
    cs2Restore: "Restore your original CS2 config?",
    elevate: "Relaunch as administrator?",
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
          aria-label="FRAMEFORGE home"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>
              FRAMEFORGE<span>®</span>
            </strong>
            <small>SYSTEM OPTIMIZER</small>
          </span>
        </a>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => {
                setView(item.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <item.icon size={18} strokeWidth={1.6} />
              <span>{item.label}</span>
              {item.id === "optimizations" && loaded ? (
                <span className="nav-count">{tweaks.length}</span>
              ) : view === item.id ? (
                <span className="nav-active-dot" />
              ) : null}
              {item.id === "cs2" && <span className="nav-new">CS2</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <div className="local-symbol">
              <ShieldCheck size={21} strokeWidth={1.4} />
            </div>
            <h4>Performance, on your terms.</h4>
            <p>
              Every tweak is free.
              <br />
              Every change is your choice.
            </p>
            <span>
              <span className="status-dot green" />
              LOCAL-FIRST. ALWAYS.
            </span>
          </div>
          <button
            className="sidebar-help"
            onClick={() =>
              setNotice({
                type: "info",
                text: "FRAMEFORGE applies only the settings you approve. In Optimizations, select a tweak to read its description and trade-off. Use Recovery to restore a saved settings batch. The Windows desktop app is required to read or change this PC.",
              })
            }
          >
            <CircleHelp size={16} />
            <span>A little guidance</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span className="status-dot green" />
            FRAMEFORGE
            <span className="sidebar-version">
              v{runtime.version || "1.0.0"}
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <strong>{nav.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-local">
              <LockKeyhole size={12} />
              Runs locally
            </span>
            <span className={`runtime-status ${windows ? "windows" : ""}`}>
              <span className="status-dot" />
              {!loaded
                ? "Connecting…"
                : windows
                  ? runtime.isAdmin
                    ? "Administrator"
                    : "Windows connected"
                  : "Browser preview"}
            </span>
            {windows && !runtime.isAdmin && (
              <button
                className="admin-button"
                disabled={!!busy}
                onClick={() => openReview({ kind: "elevate" })}
              >
                <ShieldCheck size={13} />
                Run as admin
              </button>
            )}
            <span className="avatar">FF</span>
          </div>
        </header>
        <main>
          {notice && (
            <div
              className={`notice ${notice.type}`}
              role={notice.type === "error" ? "alert" : "status"}
            >
              {notice.type === "error" ? (
                <TriangleAlert size={18} />
              ) : notice.type === "success" ? (
                <CheckCircle2 size={18} />
              ) : (
                <Info size={18} />
              )}
              <span>{notice.text}</span>
              <button
                className="icon-button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!windows && loaded && view !== "overview" && (
            <div className="preview-strip">
              <Monitor size={15} />
              <span>
                You’re exploring the browser preview. Scanning and applying
                changes require the Windows desktop app.
              </span>
              <span className="badge">PREVIEW</span>
            </div>
          )}
          {view === "overview"
            ? Overview()
            : view === "optimizations"
              ? Optimizations()
              : view === "scanner"
                ? Scanner()
                : view === "cleanup"
                  ? Cleanup()
                  : view === "cs2"
                    ? CS2()
                    : Recovery()}
        </main>
        <footer className="main-footer">
          <span>Crafted for a better game.</span>
          <span>
            <span className="status-dot green" />
            YOUR PC. YOUR CONTROL.
          </span>
        </footer>
      </div>
      {review && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setReview(null);
          }}
        >
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <div className="modal-top">
              <span className="modal-icon">
                {review.kind === "cleanup" ? (
                  <Trash2 size={23} />
                ) : review.kind.includes("cs2") ? (
                  <FileCode2 size={23} />
                ) : (
                  <ShieldCheck size={23} />
                )}
              </span>
              <button
                className="icon-button"
                disabled={!!busy}
                onClick={() => setReview(null)}
                aria-label="Close review"
              >
                <X size={20} />
              </button>
            </div>
            <span className="eyebrow muted">
              NOTHING CHANGES UNTIL YOU APPROVE
            </span>
            <h2 id="review-title">{reviewTitles[review.kind]}</h2>
            {review.kind === "apply" ? (
              <>
                <p className="modal-description">
                  {review.ids?.length} selected tweaks will be checked against
                  your current Windows settings. Already matching settings are
                  skipped. Review every item before continuing.
                </p>
                <div className="review-list">
                  {tweaks
                    .filter((t) => review.ids?.includes(t.id))
                    .map((t) => (
                      <div key={t.id}>
                        <Check size={14} />
                        <div>
                          <strong>{t.title}</strong>
                          <p>{t.description}</p>
                          {t.caveat && (
                            <p className="review-caveat">{t.caveat}</p>
                          )}
                        </div>
                        <span className={`risk-tag ${t.risk}`}>
                          {t.risk === "low" ? "Low risk" : "Trade-off"}
                        </span>
                      </div>
                    ))}
                </div>
                <div className="review-protection">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Back up first. Always.</strong>
                    <p>
                      A Windows restore point and an exact settings backup are
                      required. If either fails, tweaks will not be applied.
                    </p>
                  </div>
                </div>
                <p className="modal-fine-print">
                  Your custom Windows image may already include some settings.
                  Gains vary, and some changes need a restart. Review trade-offs
                  for features you use.
                </p>
              </>
            ) : review.kind === "cleanup" ? (
              <>
                <p className="modal-description">
                  The selected files will be permanently deleted. Settings
                  backups and Windows restore points do not recover these files.
                </p>
                <div className="review-list">
                  {cleanupCategories
                    .filter((c) => review.ids?.includes(c.id))
                    .map((c) => (
                      <div key={c.id}>
                        <Trash2 size={15} />
                        <div>
                          <strong>{c.title}</strong>
                          <p>{(c.fileCount || 0).toLocaleString()} files</p>
                        </div>
                        <strong>{bytes(c.bytes)}</strong>
                      </div>
                    ))}
                </div>
                <div className="cleanup-total">
                  <span>Total selected</span>
                  <strong>{bytes(cleanupBytes)}</strong>
                </div>
              </>
            ) : review.kind === "cs2Apply" ? (
              <>
                <p className="modal-description">
                  The managed block below will be added to your CS2 autoexec.
                  Existing contents are preserved and a backup is saved before
                  editing.
                </p>
                <pre className="config-preview">
                  {cs2?.configPreview ||
                    "Exact configuration preview is unavailable. Scan the installation again."}
                </pre>
                <p className="modal-fine-print">
                  A 300 FPS gameplay cap is a starting point for your target
                  build, and menus are capped at 60 FPS. The best cap depends on
                  stable frame times and your display. These preferences do not
                  guarantee lower input latency.
                </p>
              </>
            ) : review.kind === "cs2Restore" ? (
              <p className="modal-description">
                The saved original autoexec will replace the current file.
                Changes made after the backup was saved may be lost. Close CS2
                before continuing.
              </p>
            ) : review.kind === "restore" ? (
              <p className="modal-description">
                The exact registry and power settings from this backup will be
                restored. Settings changed after this backup may be overwritten.
                A Windows restart may be needed.
              </p>
            ) : review.kind === "elevate" ? (
              <p className="modal-description">
                FRAMEFORGE will ask Windows to relaunch this app with
                administrator privileges. Approve the Windows UAC prompt to
                continue. No tweaks are applied by relaunching.
              </p>
            ) : (
              <p className="modal-description">
                Windows will create a system restore point on your system drive.
                Administrator privileges and System Protection are required. You
                can use Windows System Restore for full system recovery.
              </p>
            )}
            {!windows ? (
              <div className="modal-warning">
                <Monitor size={19} />
                <div>
                  <strong>Windows desktop app required</strong>
                  <p>
                    This browser preview cannot read or modify your Windows
                    installation. Open FRAMEFORGE on your gaming PC to continue.
                  </p>
                </div>
              </div>
            ) : !runtime.isAdmin && review.kind !== "elevate" ? (
              <div className="modal-warning">
                <LockKeyhole size={19} />
                <div>
                  <strong>Administrator access required</strong>
                  <p>
                    Relaunch the desktop app as administrator before applying
                    system changes.
                  </p>
                </div>
              </div>
            ) : null}
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={!!busy || !windows}
              />
              <span>
                {review.kind === "cleanup"
                  ? "I approve permanently deleting the selected files."
                  : "I have reviewed these changes and approve this operation."}
              </span>
            </label>
            {busy === "mutation" && (
              <div className="operation-progress" role="status">
                <LoaderCircle size={17} className="spin" />
                <span>{progress || "Working… Please keep the app open."}</span>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setReview(null)}
              >
                Cancel
              </button>
              <button
                className={`button ${review.kind === "cleanup" ? "danger" : "primary"}`}
                disabled={
                  !!busy ||
                  !windows ||
                  (!runtime.isAdmin && review.kind !== "elevate") ||
                  !consent ||
                  (review.kind === "cs2Apply" && !cs2?.configPreview)
                }
                onClick={() => void confirmOperation()}
              >
                {busy === "mutation" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : review.kind === "cleanup" ? (
                  <Trash2 size={15} />
                ) : (
                  <Check size={16} />
                )}
                {busy === "mutation"
                  ? "Working…"
                  : review.kind === "cleanup"
                    ? "Approve & clean"
                    : review.kind === "apply"
                      ? "Approve & apply"
                      : review.kind === "restore" ||
                          review.kind === "cs2Restore"
                        ? "Approve & restore"
                        : review.kind === "restorePoint"
                          ? "Create restore point"
                          : review.kind === "elevate"
                            ? "Approve & relaunch"
                            : "Approve & save"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: any;
}) {
  return (
    <div className="page-intro">
      <div>
        <span className="eyebrow">
          <span className="little-line" />
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <span className="page-intro-icon">
        <Icon size={30} strokeWidth={1.1} />
      </span>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={30} strokeWidth={1.2} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value ?? "Not reported"}</strong>
    </div>
  );
}
function SpecCard({
  icon: Icon,
  title,
  name,
  rows,
}: {
  icon: any;
  title: string;
  name: string;
  rows: any[][];
}) {
  return (
    <section className="surface spec-card">
      <span className="spec-icon">
        <Icon size={23} strokeWidth={1.4} />
      </span>
      <span className="eyebrow muted">{title}</span>
      <h3>{name}</h3>
      <div>
        {rows.map(([label, value]) => (
          <Detail key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}
function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="surface feature-card">
      <Icon size={23} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export default App;
