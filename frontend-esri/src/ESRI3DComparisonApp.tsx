import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileArchive, Trash2, CheckCircle2, AlertCircle, Sparkles, X, BarChart3, GitCompare, Download, Info, LayoutGrid } from "lucide-react";
import JSZip from "jszip";
import * as THREE from "three";
import { fetchColumns } from "./api/data";
import { runSummary, runPlots } from "./api/analysis";

const isAcceptedName = (name: string) => {
  const lower = name.toLowerCase().trim();
  return lower.endsWith(".zip") || lower.endsWith(".csv");
};
const isAccepted = (file: File | null | undefined) => !!file && isAcceptedName(file.name);
const clampPercent = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const REQUIRED_FIELD_KEYS = ["Northing", "Easting", "Assay"] as const;
type RequiredFieldKey = typeof REQUIRED_FIELD_KEYS[number];
type ColumnMapping = Partial<Record<RequiredFieldKey, string>>;

type ThreeStash = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  animId: number;
  onResize: () => void;
};

export default function ESRI3DComparisonApp() {
  type Section = "data-loading" | "data-analysis" | "comparisons" | "export" | "about";
  const [section, setSection] = useState<Section>("data-loading");

  const [originalZip, setOriginalZip] = useState<File | null>(null);
  const [dlZip, setDlZip] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ original?: string; dl?: string }>({});
  const [toast, setToast] = useState<{ msg: string } | null>(null);

  const [originalColumns, setOriginalColumns] = useState<string[]>([]);
  const [dlColumns, setDlColumns] = useState<string[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);

  const [originalMap, setOriginalMap] = useState<ColumnMapping>({});
  const [dlMap, setDlMap] = useState<ColumnMapping>({});

  // Run Analysis in Data Analysis
  const [analysisRun, setAnalysisRun] = useState(false);

  // --- Analysis stats (Original / DL) ---
  type Summary = {
    count: number;
    mean: number | null;
    median: number | null;
    max: number | null;
    std: number | null;
  };
  const [statsOriginal, setStatsOriginal] = useState<Summary | null>(null);
  const [statsDl, setStatsDl] = useState<Summary | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // --- Plots state ---
  const [plotsLoading, setPlotsLoading] = useState(false);
  const [plots, setPlots] = useState<{ original?: string; dl?: string; qq?: string }>({});

  // Comparison controls
  const [method, setMethod] = useState<null | "max" | "mean" | "median">(null);
  const [gridSize, setGridSize] = useState<number | null>(100000);

  // Run state
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busyRun, setBusyRun] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [originalList, setOriginalList] = useState<Array<{ name: string; size: number }>>([]);
  const [dlList, setDlList] = useState<Array<{ name: string; size: number }>>([]);
  const [progress, setProgress] = useState<{ original: number; dl: number }>({ original: 0, dl: 0 });

  const inputOriginalRef = useRef<HTMLInputElement | null>(null);
  const inputDlRef = useRef<HTMLInputElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeStash | null>(null);

  // Mapping completeness (used only to enable Run Analysis)
  const mappingComplete = useMemo(() => {
    const leftOk = REQUIRED_FIELD_KEYS.every((k) => !!originalMap[k]);
    const rightOk = REQUIRED_FIELD_KEYS.every((k) => !!dlMap[k]);
    return leftOk && rightOk;
  }, [originalMap, dlMap]);

  // Controls enabled after both uploads
  const comparisonControlsEnabled = !!originalZip && !!dlZip;

  // Export after 1,2,4 chosen
  const exportEnabled = !!originalZip && !!dlZip && method !== null;

  // Ready to run comparison (full pipeline)
  const readyToRun =
    !!originalZip &&
    !!dlZip &&
    originalColumns.length > 0 &&
    dlColumns.length > 0 &&
    mappingComplete &&
    method !== null &&
    gridSize !== null &&
    gridSize >= 100 &&
    !busyRun;

  const [dataLoaded, setDataLoaded] = useState(false);

  const isZip = (file: File | null | undefined) => !!file && isAcceptedName(file.name);

  const validateAndSet = useCallback((file: File | null, kind: "original" | "dl") => {
    if (!file) {
      if (kind === "original") setOriginalZip(null);
      if (kind === "dl") setDlZip(null);
      setErrors((e) => ({ ...e, [kind]: undefined }));
      return;
    }
    if (!isAccepted(file)) {
      setErrors((e) => ({ ...e, [kind]: "Only .zip or .csv files are accepted." }));
      return;
    }
    setErrors((e) => ({ ...e, [kind]: undefined }));
    if (kind === "original") setOriginalZip(file);
    if (kind === "dl") setDlZip(file);
    setToast({ msg: `${kind === "original" ? "Original ESRI" : "DL ESRI"} file uploaded successfully.` });
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>, kind: "original" | "dl") => {
    const file = e.target.files?.[0] ?? null;
    validateAndSet(file, kind);
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>, kind: "original" | "dl") => {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    validateAndSet(file ?? null, kind);
  };
  const onDragOver = (ev: React.DragEvent<HTMLDivElement>) => ev.preventDefault();

  // three.js helpers
  const safelyDisposeThree = useCallback((container: HTMLDivElement | null) => {
    const stash = threeRef.current;
    if (!stash) return;
    try { cancelAnimationFrame(stash.animId); } catch {}
    try { window.removeEventListener("resize", stash.onResize); } catch {}
    try {
      const canvas = stash.renderer?.domElement;
      const parent = canvas?.parentNode as (Node & ParentNode) | null;
      if (canvas && parent && parent.contains(canvas)) parent.removeChild(canvas);
    } catch {}
    try { stash.renderer?.dispose(); } catch {}
    threeRef.current = null;
  }, []);

  const renderPlaceholder3D = useCallback(() => {
    const container = plotRef.current;
    if (!container) return;
    safelyDisposeThree(container);

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9fafb);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(3, 2.2, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    const planeGeo = new THREE.PlaneGeometry(12, 12);
    const planeMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 1, metalness: 0 });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -1.25;
    plane.receiveShadow = true;
    scene.add(plane);

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const purpleMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed });
    const amberMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
    const cube1 = new THREE.Mesh(cubeGeo, purpleMat); cube1.position.x = -1.2;
    const cube2 = new THREE.Mesh(cubeGeo, amberMat);  cube2.position.x =  1.2;
    scene.add(cube1, cube2);

    const clock = new THREE.Clock();
    const animate = () => {
      const t = clock.getElapsedTime();
      cube1.rotation.x = t * 0.6; cube1.rotation.y = t * 0.9;
      cube2.rotation.x = -t * 0.5; cube2.rotation.y = -t * 0.8;
      renderer.render(scene, camera);
      const id = requestAnimationFrame(animate);
      if (threeRef.current) threeRef.current.animId = id;
    };

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", onResize);
    threeRef.current = { renderer, scene, camera, animId: requestAnimationFrame(animate), onResize };
  }, [safelyDisposeThree]);

  useEffect(() => () => { safelyDisposeThree(plotRef.current); }, [safelyDisposeThree]);

  async function inspectZipColumns(file: File): Promise<string[]> {
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        // For CSV, fake columns (should parse header in real app)
        return ["ID", "Northing", "Easting", "RL", "Assay", "Te_ppm", "Au_ppb", "Depth"];
      }
      const buf = await file.arrayBuffer();
      await JSZip.loadAsync(buf);
      return ["ID", "Northing", "Easting", "RL", "Assay", "Te_ppm", "Au_ppb", "Depth"];
    } catch {
      return ["ID", "Northing", "Easting", "Assay"];
    }
  }

  async function onLoadData() {
    if (!originalZip || !dlZip || loadingColumns || dataLoaded) return;
    setLoadingColumns(true);
    setOriginalList([{ name: originalZip.name, size: originalZip.size }]);
    setDlList([{ name: dlZip.name, size: dlZip.size }]);
    setProgress({ original: 100, dl: 100 });

    try {
      // Ask backend for real columns
      const { original_columns, dl_columns } = await fetchColumns(originalZip, dlZip);

      setOriginalColumns(original_columns);
      setDlColumns(dl_columns);

      // reset mappings so user re-selects
      setOriginalMap({});
      setDlMap({});
      setAnalysisRun(false);
      setStatsOriginal(null);
      setStatsDl(null);
      setDataLoaded(true);
    } catch (e: any) {
      // Show error and also clear loading state and progress
      alert(e?.message || "Failed to read columns");
      setDataLoaded(false);
      setOriginalColumns([]);
      setDlColumns([]);
      setOriginalList([]);
      setDlList([]);
      setProgress({ original: 0, dl: 0 });
    } finally {
      setLoadingColumns(false);
    }
  }

  // Run Analysis → clean assay (drop <= 0) & compute stats via backend
  async function handleRunAnalysis() {
    if (!originalZip || !dlZip) {
      alert("Upload both files and click Load Data first.");
      return;
    }
    const oAssay = originalMap["Assay"];
    const dAssay = dlMap["Assay"];
    if (!oAssay || !dAssay) {
      alert("Select the Assay column on both sides.");
      return;
    }

    setAnalysisLoading(true);
    setStatsOriginal(null);
    setStatsDl(null);

    try {
      const { original, dl } = await runSummary(originalZip, dlZip, oAssay, dAssay);
      setStatsOriginal(original);
      setStatsDl(dl);
      setAnalysisRun(true);
    } catch (err: any) {
      console.error("Run Analysis failed:", err);
      const msg = typeof err?.message === "string" ? err.message : "Run Analysis failed";
      alert(msg);
    } finally {
      setAnalysisLoading(false);
    }
  }

  // --- Plots handler ---
  async function handleShowPlots() {
    if (!originalZip || !dlZip) return;
    const oAssay = originalMap["Assay"];
    const dAssay = dlMap["Assay"];
    if (!oAssay || !dAssay) {
      alert("Select the Assay column on both sides.");
      return;
    }
    try {
      setPlotsLoading(true);
      setPlots({});
      const r = await runPlots(originalZip, dlZip, oAssay, dAssay);
      setPlots({
        original: `data:image/png;base64,${r.original_png}`,
        dl: `data:image/png;base64,${r.dl_png}`,
        qq: `data:image/png;base64,${r.qq_png}`,
      });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to render plots");
    } finally {
      setPlotsLoading(false);
    }
  }

  async function onRun() {
    setRunError(null);
    setProgress({ original: 0, dl: 0 });
    setUnzipping(false);
    setRunId(null);

    try {
      if (!readyToRun) throw new Error("Complete uploads, load data, mappings, method and grid size first.");
      setBusyRun(true);

      renderPlaceholder3D();

      const { run_id } = await createRun({
        originalZip: originalZip!,
        dlZip: dlZip!,
        comparison_method: method!,
      });
      setRunId(run_id);
      setSection("comparisons");
    } catch (err: any) {
      console.error("Run failed:", err);
      const msg = typeof err?.message === "string" ? err.message : "Run failed. See console.";
      setRunError(msg);
      alert(msg);
      setUnzipping(false);
    } finally {
      setBusyRun(false);
    }
  }

  function onExport(type: "png" | "csv") {
    if (!runId) {
      alert("Nothing to export yet. Please run a comparison first.");
      return;
    }
    alert(`Exporting ${type.toUpperCase()}… (wire to backend)`);
  }

  // --- Reset helpers ---
  function resetDataLoading() {
    setOriginalZip(null);
    setDlZip(null);
    setErrors({});
    setOriginalColumns([]);
    setDlColumns([]);
    setLoadingColumns(false);
    setOriginalList([]);
    setDlList([]);
    setProgress({ original: 0, dl: 0 });
    setDataLoaded(false);
    // Reset file input elements so the same file can be re-uploaded
    if (inputOriginalRef.current) inputOriginalRef.current.value = "";
    if (inputDlRef.current) inputDlRef.current.value = "";
    resetAnalysis();
  }
  function resetAnalysis() {
    setOriginalMap({});
    setDlMap({});
    setAnalysisRun(false);
    setStatsOriginal(null);
    setStatsDl(null);
    setPlots({}); // <-- clear plots state as well
    setPlotsLoading(false); // <-- reset loading state for plots
    resetComparison();
  }
  function resetComparison() {
    setMethod(null);
    setGridSize(null);
    setRunId(null);
    setRunError(null);
    setBusyRun(false);
    setUnzipping(false);
    // Dispose three.js visualization and clear plotRef
    if (threeRef.current) safelyDisposeThree(plotRef.current);
    if (plotRef.current && plotRef.current.firstChild) {
      while (plotRef.current.firstChild) {
        plotRef.current.removeChild(plotRef.current.firstChild);
      }
    }
  }

  // Only enable Comparison after Run Analysis has been clicked
  const canGoToComparison = analysisRun;

  // Lightbox state and helpers
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState<string>("");

  function openLightbox(src: string, title: string) {
    setLightboxSrc(src);
    setLightboxTitle(title);
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxSrc(null);
    setLightboxTitle("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
    }
    if (lightboxOpen) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  return (
    <div className="min-h-screen bg-white text-[#111827] flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:flex-col fixed top-0 left-0 h-screen w-64 border-r border-neutral-200 bg-[#F9FAFB] z-30">
        <div className="px-4 pt-8 pb-4 flex items-start gap-3">
          <div className="rounded-2xl bg-[#7C3AED] text-white p-2 shadow-sm"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">ESRI Comparison</h1>
            <p className="text-xs text-neutral-600">Original vs DL assay checks</p>
          </div>
        </div>
        <nav className="mt-2 px-2 space-y-1">
          <SidebarItem
            icon={<Upload className="h-4 w-4" />}
            label="Data Loading"
            active={section === "data-loading"}
            onClick={() => setSection("data-loading")}
          />
          <SidebarItem
            icon={<BarChart3 className="h-4 w-4" />}
            label="Data Analysis"
            active={section === "data-analysis"}
            onClick={() => setSection("data-analysis")}
          />
          <SidebarItem
            icon={<GitCompare className="h-4 w-4" />}
            label="Comparison"
            active={section === "comparisons"}
            onClick={() => setSection("comparisons")}
          />
          <SidebarItem
            icon={<Download className="h-4 w-4" />}
            label="Export"
            active={section === "export"}
            onClick={() => setSection("export")}
          />
        </nav>
        <div className="mt-auto p-3">
          <SidebarItem icon={<Info className="h-4 w-4" />} label="About" active={section === "about"} onClick={() => setSection("about")} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 md:ml-64">
        <header>
          <div className="mx-auto max-w-6xl px-4 pt-8 pb-4 md:pt-10 md:pb-6">
            <div className="flex items-start gap-3 md:hidden">
              <div className="rounded-2xl bg-[#7C3AED] text-white p-2 shadow-sm"><Sparkles className="h-5 w-5" /></div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">ESRI Comparison</h1>
                <p className="mt-1 text-neutral-700 text-sm max-w-2xl">Upload the <strong>Original</strong> and <strong>DL</strong> .zip files, load data, set mappings in Data Analysis, then run a comparison.</p>
              </div>
            </div>

            {/* Progress steps hidden on About */}
            {section !== "about" && (
              <nav aria-label="progress" className="mt-4">
                <ol className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                  <StepItem number={1} title="Original ESRI" done={!!originalZip} />
                  <StepItem number={2} title="DL ESRI" done={!!dlZip} />
                  <StepItem number={3} title="Mapping" done={analysisRun} />
                  <StepItem number={4} title="Method" done={method !== null} />
                  {/* Remove grid size step here */}
                  {/* <StepItem number={5} title="Grid Size" done={gridSize !== null && gridSize >= 100} /> */}
                  <StepItem number={5} title="Plot" done={!!runId} />
                </ol>
              </nav>
            )}
          </div>
        </header>

        <SuccessToast toast={toast} onClose={() => setToast(null)} />

        <main className="mx-auto max-w-6xl px-4 pb-16">
          {/* Data Selection */}
          {section === "data-loading" && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <UploadPanel
                  step={1}
                  title="File Upload for Original ESRI Data"
                  subtitle="Only .zip or .csv files are accepted. Drag & drop or click to browse."
                  file={originalZip}
                  error={errors.original}
                  onClear={() => validateAndSet(null, "original")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) => onDrop(e, "original")}
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) => onDragOver(e)}
                  onBrowse={() => inputOriginalRef.current?.click()}
                >
                  <input ref={inputOriginalRef} type="file" accept=".zip,.csv" className="hidden" onChange={(e) => handleInput(e, "original")} />
                </UploadPanel>

                <UploadPanel
                  step={2}
                  title="File Upload for DL ESRI Data"
                  subtitle="Only .zip or .csv files are accepted. Drag & drop or click to browse."
                  file={dlZip}
                  error={errors.dl}
                  onClear={() => validateAndSet(null, "dl")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) => onDrop(e, "dl")}
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) => onDragOver(e)}
                  onBrowse={() => inputDlRef.current?.click()}
                >
                  <input ref={inputDlRef} type="file" accept=".zip,.csv" className="hidden" onChange={(e) => handleInput(e, "dl")} />
                </UploadPanel>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={onLoadData}
                  disabled={!originalZip || !dlZip || loadingColumns || dataLoaded}
                  className={
                    "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                    (!!originalZip && !!dlZip && !loadingColumns && !dataLoaded
                      ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                      : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                  }
                >
                  {loadingColumns ? "Loading…" : "Load Data"}
                  {dataLoaded && (
                    <span className="inline-flex items-center text-[#10B981] ml-2">
                      <CheckCircle2 className="h-5 w-5" />
                    </span>
                  )}
                </button>
                {dataLoaded && (
                  <button
                    type="button"
                    className="ml-2 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                    onClick={resetDataLoading}
                  >
                    Clear
                  </button>
                )}
              </div>

              {(loadingColumns || dataLoaded) && (
                <section className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <ZipList
                    title={originalZip?.name || "Original.zip"}
                    progress={progress.original}
                    items={originalList}
                    accent="#7C3AED"
                  />
                  <ZipList
                    title={dlZip?.name || "DL.zip"}
                    progress={progress.dl}
                    items={dlList}
                    accent="#F59E0B"
                  />
                </section>
              )}

              {dataLoaded && !!originalZip && !!dlZip && (
                <div className="mt-6 flex justify-end">
                  <button
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[#7C3AED] text-white hover:bg-[#6D28D9] transition"
                    onClick={() => setSection("data-analysis")}
                  >
                    Go to Data Analysis
                  </button>
                </div>
              )}
            </>
          )}

          {/* Data Analysis (Mappings + Run Analysis) */}
          {section === "data-analysis" && (
            <>
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <LayoutGrid className="h-4 w-4 text-[#7C3AED]" />
                  <h2 className="text-lg font-semibold">Mappings</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <MappingForm title="Original" columns={originalColumns} mapping={originalMap} onChange={setOriginalMap} />
                  <MappingForm title="DL" columns={dlColumns} mapping={dlMap} onChange={setDlMap} />
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    onClick={handleRunAnalysis}
                    disabled={!mappingComplete || analysisRun || analysisLoading}
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                      (mappingComplete && !analysisRun && !analysisLoading
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    {analysisLoading ? "Analysing…" : "Run Analysis"}
                    {analysisRun && !analysisLoading && (
                      <span className="inline-flex items-center text-[#10B981] ml-2">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                    )}
                  </button>
                  <button
                    onClick={handleShowPlots}
                    disabled={!analysisRun || plotsLoading || !!(plots.original && plots.dl && plots.qq)}
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition flex items-center gap-2 " +
                      (
                        !analysisRun || plotsLoading
                          ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                          : (!plots.original || !plots.dl || !plots.qq)
                            ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                            : "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                      )
                    }
                  >
                    {plotsLoading
                      ? "Rendering…"
                      : (plots.original && plots.dl && plots.qq)
                        ? (
                          <>
                            Show Plots
                            <span className="inline-flex items-center text-[#10B981] ml-2">
                              <CheckCircle2 className="h-5 w-5" />
                            </span>
                          </>
                        )
                        : "Show Plots"
                    }
                  </button>
                  {analysisRun && !analysisLoading && (
                    <button
                      type="button"
                      className="ml-2 rounded-xl px-4 py-2 text-sm font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
                      onClick={resetAnalysis}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Only show stats after analysis is done */}
                {analysisRun && !analysisLoading && (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <InfoCard label="Assay - mean"   value={`${fmt(statsOriginal?.mean)} / ${fmt(statsDl?.mean)}`}   hint="Original / DL" />
                    <InfoCard label="Assay - median" value={`${fmt(statsOriginal?.median)} / ${fmt(statsDl?.median)}`} hint="Original / DL" />
                    <InfoCard label="Assay - max"    value={`${fmt(statsOriginal?.max)} / ${fmt(statsDl?.max)}`}     hint="Original / DL" />
                    <InfoCard label="Assay - std"    value={`${fmt(statsOriginal?.std)} / ${fmt(statsDl?.std)}`}     hint="Original / DL" />
                  </div>
                )}

                {/* Plots gallery */}
                {analysisRun && !analysisLoading && (plots.original || plots.dl || plots.qq) && (
                  <section className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                      <div className="text-sm font-medium mb-2">Original histogram</div>
                      {plots.original ? (
                        <button
                          type="button"
                          onClick={() => plots.original && openLightbox(plots.original, "Original histogram")}
                          className="block w-full cursor-zoom-in"
                          aria-label="Open Original histogram"
                        >
                          <img
                            src={plots.original}
                            alt="Original histogram"
                            className="w-full h-[260px] object-contain rounded-xl bg-[#F9FAFB] border border-neutral-100"
                          />
                        </button>
                      ) : (
                        <div className="h-[260px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                          No plot yet
                        </div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                      <div className="text-sm font-medium mb-2">DL histogram</div>
                      {plots.dl ? (
                        <button
                          type="button"
                          onClick={() => plots.dl && openLightbox(plots.dl, "DL histogram")}
                          className="block w-full cursor-zoom-in"
                          aria-label="Open DL histogram"
                        >
                          <img
                            src={plots.dl}
                            alt="DL histogram"
                            className="w-full h-[260px] object-contain rounded-xl bg-[#F9FAFB] border border-neutral-100"
                          />
                        </button>
                      ) : (
                        <div className="h-[260px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                          No plot yet
                        </div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                      <div className="text-sm font-medium mb-2">QQ plot (log–log)</div>
                      {plots.qq ? (
                        <button
                          type="button"
                          onClick={() => plots.qq && openLightbox(plots.qq, "QQ plot (log–log)")}
                          className="block w-full cursor-zoom-in"
                          aria-label="Open QQ plot"
                        >
                          <img
                            src={plots.qq}
                            alt="QQ plot"
                            className="w-full h-[260px] object-contain rounded-xl bg-[#F9FAFB] border border-neutral-100"
                          />
                        </button>
                      ) : (
                        <div className="h-[260px] grid place-items-center text-sm text-neutral-500 bg-[#F9FAFB] rounded-xl border border-neutral-100">
                          No plot yet
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </section>

              <section className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <InfoCard label="Original columns" value={originalColumns.length ? originalColumns.length : "—"} hint="After Load Data" />
                <InfoCard label="DL columns" value={dlColumns.length ? dlColumns.length : "—"} hint="After Load Data" />
                <InfoCard label="Mappings complete" value={mappingComplete ? "Yes" : "No"} hint="Select all 3 per side" />
              </section>

              {analysisRun && (
                <div className="mt-6 flex justify-end">
                  <button
                    className="rounded-xl px-5 py-2.5 text-sm font-medium bg-[#7C3AED] text-white hover:bg-[#6D28D9] transition"
                    onClick={() => setSection("comparisons")}
                  >
                    Go to Comparison
                  </button>
                </div>
              )}
            </>
          )}

          {/* Comparisons */}
          {section === "comparisons" && (
            <>
              <div className={analysisRun ? "" : "opacity-50 pointer-events-none"}>
                <ControlsBar
                  method={method}
                  onMethodChange={analysisRun ? setMethod as any : () => {}}
                  gridSize={gridSize}
                  onGridSizeChange={analysisRun ? setGridSize : () => {}}
                />
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="mt-8 flex flex-wrap items-center gap-3"
                >
                  <button
                    type="button"
                    onClick={onRun}
                    disabled={!readyToRun || !analysisRun || !!runId}
                    aria-disabled={!readyToRun || !analysisRun || !!runId}
                    className={
                      "rounded-xl px-4 py-2 transition flex items-center gap-2 " +
                      (readyToRun && analysisRun && !runId
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9] shadow"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    Run Comparison
                    {runId && (
                      <span className="inline-flex items-center text-[#10B981] ml-2">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                    )}
                  </button>
                  {/* Enable Clear only if something is selected (method or gridSize) */}
                  <button
                    type="button"
                    className={
                      "ml-2 rounded-xl px-4 py-2 text-sm font-medium transition " +
                      ((method !== null || gridSize !== null)
                        ? "bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
                        : "bg-neutral-200 text-neutral-400 cursor-not-allowed")
                    }
                    onClick={resetComparison}
                    disabled={!(method !== null || gridSize !== null)}
                  >
                    Clear
                  </button>
                  {runError && <span style={{ color: "#c00" }}>{runError}</span>}
                </motion.div>
              </div>
              <section className="mt-8">
                <h2 className="text-lg font-semibold mb-3">Plots (Original/ DL/ Comparison)</h2>
              </section>
            </>
          )}

          {/* Export */}
          {section === "export" && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
              <h2 className="text-lg font-semibold mb-3">Export Results</h2>
              <div className="flex flex-wrap gap-3">
                <button
                  className={
                    "rounded-xl px-4 py-2 text-sm transition " +
                    (exportEnabled ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]" : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                  }
                  disabled={!exportEnabled}
                  onClick={() => onExport("png")}
                >
                  Export Heatmap PNG
                </button>
                <button
                  className={
                    "rounded-xl px-4 py-2 text-sm transition " +
                    (exportEnabled ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]" : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                  }
                  disabled={!exportEnabled}
                  onClick={() => onExport("csv")}
                >
                  Export Grid CSV
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-3">Buttons enable after the first 3 steps.</p>
            </section>
          )}

          {/* About */}
          {section === "about" && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-5">
              <h2 className="text-lg font-semibold mb-2">About</h2>
              <p className="text-sm text-neutral-700 mb-3">
                This application was developed as part of a university project to support geochemical exploration workflows.
                It helps compare two datasets in a clear spatial context.
              </p>
              <h3 className="text-md font-semibold mt-4 mb-2">The tool allows users to:</h3>
              <ul className="list-disc pl-6 text-sm text-neutral-700 space-y-1">
                <li>Upload datasets of original and DL values.</li>
                <li>Compare samples on a common grid.</li>
                <li>Apply different comparison methods to evaluate differences.</li>
                <li>Visualize results as coloured maps for each dataset and the computed comparison.</li>
                <li>Export the processed grid values to CSV for further analysis or use in other software.</li>
              </ul>
              <h3 className="text-md font-semibold mt-4 mb-2">Key Features:</h3>
              <ul className="list-disc pl-6 text-sm text-neutral-700 space-y-1">
                <li>Multiple grid maps (Original, DL, Comparison).</li>
                <li>Multiple comparison algorithms.</li>
                <li>Data export to CSV.</li>
                <li>Workflow reset for new sessions.</li>
              </ul>
            </section>
          )}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-neutral-500" />
      </div>

      {/* Lightbox modal */}
      <AnimatePresence>
        {lightboxOpen && lightboxSrc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={closeLightbox}
            aria-modal="true"
            role="dialog"
          >
            <div
              className="absolute inset-0 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className="relative w-full max-w-6xl"
              >
                <div className="mb-2 flex items-center justify-between text-white">
                  <h3 className="text-sm md:text-base font-medium">{lightboxTitle}</h3>
                  <button
                    onClick={closeLightbox}
                    className="inline-flex items-center rounded-xl bg-white/10 hover:bg-white/20 px-2 py-1"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
                <div className="rounded-2xl bg-white p-2 md:p-3">
                  <img
                    src={lightboxSrc}
                    alt={lightboxTitle}
                    className="max-h-[80vh] w-full object-contain rounded-xl"
                  />
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Sidebar item */
function SidebarItem({ icon, label, active, onClick, disabled }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={
        "w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition " +
        (active
          ? "bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]"
          : disabled
            ? "text-neutral-300 bg-neutral-50 cursor-not-allowed"
            : "text-neutral-700 hover:bg-neutral-100 border border-transparent")
      }
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
    >
      <span className={active ? "text-[#7C3AED]" : disabled ? "text-neutral-300" : "text-neutral-500"}>{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

/* Step item */
function StepItem({ number, title, done }: { number: number; title: string; done: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <div className={"relative h-9 w-9 shrink-0 grid place-items-center rounded-2xl border " + (done ? "border-[#10B981] bg-[#10B981]/10 text-[#10B981]" : "border-neutral-300 bg-white text-neutral-700")}>
        {done ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-semibold">{number}</span>}
      </div>
      <div className="text-sm font-medium">{title}</div>
    </li>
  );
}

/* Upload panel */
function UploadPanel({ step, title, subtitle, file, error, onClear, onDrop, onDragOver, onBrowse, children }: any) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }} className="rounded-3xl border border-neutral-200 bg-[#F9FAFB] shadow-md overflow-hidden">
      <div className="p-5 border-b border-neutral-200 flex items-start gap-3">
        <div className="rounded-xl bg-[#7C3AED] text-white px-2 py-1 text-xs font-semibold">Step {step}</div>
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
        </div>
      </div>
      <div
        className="m-5 rounded-2xl border-2 border-dashed border-neutral-300 hover:border-[#7C3AED] transition bg-white"
        onDrop={onDrop}
        onDragOver={onDragOver}
        role="button"
        tabIndex={0}
        onClick={onBrowse}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onBrowse()}
        aria-label="Upload .zip or .csv file"
      >
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[#7C3AED]/10 grid place-items-center text-[#7C3AED]"><Upload className="h-6 w-6" /></div>
          <p className="text-sm font-semibold">Drag & drop a .zip or .csv here, or <span className="underline text-[#7C3AED]">browse</span></p>
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-neutral-600"><Badge><FileArchive className="h-3.5 w-3.5" /> .zip or .csv</Badge></div>
        </div>
        {children}
      </div>
      <div className="px-5 pb-5">
        {file && (
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2">
            <div className="min-w-0 flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-[#7C3AED]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-neutral-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            </div>
            <button type="button" onClick={onClear} className="ml-3 inline-flex items-center gap-1 rounded-xl bg-red-100 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-200"> <Trash2 className="h-3.5 w-3.5" /> Remove </button>
          </div>
        )}
        {!!error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </motion.section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-lg bg-[#F9FAFB] px-2 py-0.5 text-[11px] font-medium text-[#111827] border border-neutral-200">{children}</span>;
}

/* Toast */
function SuccessToast({ toast, onClose }: { toast: { msg: string } | null; onClose: () => void; }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => onClose(), 2400);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} aria-live="polite" className="fixed top-4 right-4 z-50">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 shadow-lg shadow-emerald-100">
            <CheckCircle2 className="h-5 w-5" />
            <div className="text-sm font-medium">{toast?.msg}</div>
            <button onClick={onClose} className="ml-2 text-emerald-700/80 hover:text-emerald-900"><X className="h-4 w-4" /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* Zip list card (used inline under Load Data) */
function ZipList({ title, progress, items, accent }: { title: string; progress: number; items: Array<{ name: string; size: number }>; accent: string; }) {
  return (
    <div className="rounded-2xl border border-neutral-200">
      <div className="p-3 flex items-center justify-between">
        <div className="font-medium truncate" title={title}>{title}</div>
        <div className="text-xs text-neutral-500">{items.length} files</div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-2 w-full rounded bg-neutral-100 overflow-hidden">
          <div className="h-full" style={{ width: `${progress}%`, background: accent }} />
        </div>
        <ul className="mt-3 max-h-60 overflow-auto divide-y divide-neutral-100">
          {items.length === 0 ? (
            progress === 100
              ? <li className="py-3 text-xs text-neutral-500">Ready</li>
              : <li className="py-3 text-xs text-neutral-500">Listing…</li>
          ) : (
            items.map((f, idx) => (
              <li key={idx} className="py-2 text-sm flex items-center gap-2">
                <FileArchive className="h-4 w-4 text-neutral-500" />
                <span className="truncate" title={f.name}>{f.name}</span>
                <span className="ml-auto text-xs text-neutral-400">{(f.size / 1024).toFixed(1)} KB</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/* Controls Bar (parser-friendly) */
function ControlsBar(props: {
  method: null | "max" | "mean" | "median";
  onMethodChange: (m: "max" | "mean" | "median") => void;
  gridSize: number | null;
  onGridSizeChange: (n: number | null) => void;
}) {
  const { method, onMethodChange, gridSize, onGridSizeChange } = props;

  const METHOD_OPTIONS = [
    { value: "mean", label: "Mean" },
    { value: "median", label: "Median" },
    { value: "max", label: "Max" },
  ] as const;

  const tabRefs = React.useRef<any[]>([]);
  const selectedIdx = method ? METHOD_OPTIONS.findIndex(o => o.value === method) : -1;

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (selectedIdx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (selectedIdx + dir + METHOD_OPTIONS.length) % METHOD_OPTIONS.length;
      const m = METHOD_OPTIONS[next].value;
      onMethodChange(m);
      tabRefs.current[next]?.focus();
    }
  }

  const minGrid = 100, maxGrid = 900000, stepGrid = 50;

  return (
    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 md:p-5">
      <div className="flex flex-col md:flex-row justify-between gap-4 md:gap-6 w-full">
        <div className="flex flex-col gap-2 min-w-[220px]">
          <span className="text-sm font-medium text-neutral-700 mb-1">Comparison Method</span>
          <div className="flex flex-row gap-2" role="tablist" aria-label="Comparison Method">
            {METHOD_OPTIONS.map((opt, idx) => {
              const active = method === opt.value;
              return (
                <button
                  key={opt.value}
                  ref={el => (tabRefs.current[idx] = el)}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active || method === null ? 0 : -1}
                  onClick={() => onMethodChange(opt.value)}
                  onKeyDown={handleTabKeyDown}
                  className={
                    "px-3 py-1.5 h-9 rounded-xl text-sm font-medium transition " +
                    (active ? "bg-[#7C3AED] text-white" : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full md:justify-end">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <label className="text-sm font-medium text-neutral-700 mb-1">Grid Cell Size</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={minGrid}
                max={maxGrid}
                step={stepGrid}
                value={gridSize ?? minGrid}
                onChange={(e) => onGridSizeChange(Number(e.target.value))}
                className="w-40"
              />
              <input
                type="number"
                min={minGrid}
                max={maxGrid}
                step={stepGrid}
                value={gridSize ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v === null) onGridSizeChange(null);
                  else onGridSizeChange(Math.max(minGrid, Math.min(maxGrid, v)));
                }}
                placeholder={`${minGrid}-${maxGrid}`}
                className="h-9 w-24 rounded-lg border border-neutral-300 px-2 text-sm"
              />
              <span className="text-sm text-neutral-700 font-medium">{gridSize !== null ? `${gridSize} m` : "-- m"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Mapping Form */
function MappingForm({
  title, columns, mapping, onChange
}: { title: string; columns: string[]; mapping: ColumnMapping; onChange: (next: ColumnMapping) => void; }) {
  const setField = (key: RequiredFieldKey, value: string) =>
    onChange({ ...mapping, [key]: value || undefined });

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 font-medium">{title}</div>
      {columns.length === 0 ? (
        <div className="text-sm text-neutral-500">Load Data in Data Loading tab to populate columns.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {["Northing","Easting","Assay"].map((label) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-28 text-sm text-neutral-700">{label}</div>
              <select
                value={mapping[label as RequiredFieldKey] ?? ""}
                onChange={(e) => setField(label as RequiredFieldKey, e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Please select a column</option>
                {columns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Tiny info card */
function InfoCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-[#F9FAFB] p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#111827]">{value}</div>
      {hint && <div className="text-xs text-neutral-500 mt-1">{hint}</div>}
    </div>
  );
}

const fmt = (v?: number | null) => {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  const rounded = Math.round(v * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
};
