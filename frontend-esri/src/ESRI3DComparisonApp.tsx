import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileArchive, Trash2, CheckCircle2, AlertCircle, Sparkles, X, BarChart3, GitCompare, Download, Info, LayoutGrid} from "lucide-react";
import JSZip from "jszip";
import * as THREE from "three";
import ComparisonHeatmap from "./components/ComparisonHeatmap";
import { createRun } from "./api/runs";

/**
 * ESRI 3D Comparison — Inline files lists
 * - Stepper hidden on About.
 * - Steps: 1 Original, 2 DL, 3 Mapping, 4 Method, 5 Grid, 6 Plot.
 * - Step 3 “Mapping” ticks after “Run Analysis” is pressed.
 * - File lists now render under Load Data, Original at left and DL at right.
 */

const isZipName = (name: string) => name.toLowerCase().trim().endsWith(".zip");
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

  // Comparison controls
  const [method, setMethod] = useState<null | "max" | "mean" | "median" | "chi2">(null);
  const [bins, setBins] = useState<number>(10);
  const [gridSize, setGridSize] = useState<number | null>(null);

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

  const isZip = (file: File | null | undefined) => !!file && isZipName(file.name);

  const validateAndSet = useCallback((file: File | null, kind: "original" | "dl") => {
    if (!file) {
      if (kind === "original") setOriginalZip(null);
      if (kind === "dl") setDlZip(null);
      setErrors((e) => ({ ...e, [kind]: undefined }));
      return;
    }
    if (!isZip(file)) {
      setErrors((e) => ({ ...e, [kind]: "Only .zip files are accepted." }));
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
    setOriginalList([]);
    setDlList([]);
    setProgress({ original: 0, dl: 0 });

    const unzipAndList = async (file: File, which: "original" | "dl") => {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const entries = Object.values(zip.files);
      const total = entries.length || 1;
      const items: Array<{ name: string; size: number }> = [];

      let lastT = 0; let lastPct = -1;
      const bump = (i: number) => {
        const now = performance.now();
        const pct = clampPercent((i / total) * 100);
        if (pct !== lastPct && (now - lastT > 80 || Math.abs(pct - lastPct) >= 2 || pct === 100)) {
          lastT = now; lastPct = pct;
          setProgress((p) => ({ ...p, [which]: pct }));
        }
      };

      for (let i = 0; i < entries.length; i++) {
        const zf: any = entries[i];
        const approxSize = zf?._data?.uncompressedSize ?? 0;
        items.push({ name: zf.name, size: approxSize });
        bump(i + 1);
        if (i % 100 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      if (which === "original") setOriginalList(items); else setDlList(items);
    };

    try {
      await Promise.all([
        unzipAndList(originalZip, "original"),
        unzipAndList(dlZip, "dl"),
      ]);
      const [a, b] = await Promise.all([
        inspectZipColumns(originalZip),
        inspectZipColumns(dlZip),
      ]);
      setOriginalColumns(a);
      setDlColumns(b);
      setOriginalMap({});
      setDlMap({});
      setAnalysisRun(false);
      setDataLoaded(true);
    } finally {
      setLoadingColumns(false);
    }
  }

  async function onRun() {
    setRunError(null);
    // setOriginalList([]); // Do not clear file lists
    // setDlList([]); // Do not clear file lists
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
        chi2_bins: bins,
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

  // Only enable Comparison after Run Analysis has been clicked
  const canGoToComparison = analysisRun;

  return (
    <div className="min-h-screen bg-white text-[#111827] flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 border-r border-neutral-200 bg-[#F9FAFB]">
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
      <div className="flex-1 min-w-0">
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
                  <StepItem number={5} title="Grid Size" done={gridSize !== null && gridSize >= 100} />
                  <StepItem number={6} title="Plot" done={!!runId} />
                </ol>
              </nav>
            )}
          </div>
        </header>

        <SuccessToast toast={toast} onClose={() => setToast(null)} />

        <main className="mx-auto max-w-6xl px-4 pb-16">
          {/* Data Loading */}
          {section === "data-loading" && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <UploadPanel
                  step={1}
                  title="File Upload for Original ESRI Data"
                  subtitle="Only .zip files are accepted. Drag & drop or click to browse."
                  file={originalZip}
                  error={errors.original}
                  onClear={() => validateAndSet(null, "original")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) => onDrop(e, "original")}
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) => onDragOver(e)}
                  onBrowse={() => inputOriginalRef.current?.click()}
                >
                  <input ref={inputOriginalRef} type="file" accept=".zip" className="hidden" onChange={(e) => handleInput(e, "original")} />
                </UploadPanel>

                <UploadPanel
                  step={2}
                  title="File Upload for DL ESRI Data"
                  subtitle="Only .zip files are accepted. Drag & drop or click to browse."
                  file={dlZip}
                  error={errors.dl}
                  onClear={() => validateAndSet(null, "dl")}
                  onDrop={(e: React.DragEvent<HTMLDivElement>) => onDrop(e, "dl")}
                  onDragOver={(e: React.DragEvent<HTMLDivElement>) => onDragOver(e)}
                  onBrowse={() => inputDlRef.current?.click()}
                >
                  <input ref={inputDlRef} type="file" accept=".zip" className="hidden" onChange={(e) => handleInput(e, "dl")} />
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
              </div>

              {/* Inline file lists below the Load button */}
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

                <div className="mt-5">
                  <button
                    onClick={() => setAnalysisRun(true)}
                    disabled={!mappingComplete}
                    className={
                      "rounded-xl px-5 py-2.5 text-sm font-medium transition " +
                      (mappingComplete ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9]" : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    Run Analysis
                  </button>
                </div>

                {analysisRun && (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <InfoCard label="Assay — mean" value="—" hint="Connect backend" />
                    <InfoCard label="Assay — median" value="—" hint="Connect backend" />
                    <InfoCard label="Assay — max" value="—" hint="Connect backend" />
                    <InfoCard label="Assay — std" value="—" hint="Connect backend" />
                  </div>
                )}
              </section>

              <section className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <InfoCard label="Original columns" value={originalColumns.length ? originalColumns.length : "—"} hint="After Load Data" />
                <InfoCard label="DL columns" value={dlColumns.length ? dlColumns.length : "—"} hint="After Load Data" />
                <InfoCard label="Mappings complete" value={mappingComplete ? "Yes" : "No"} hint="Select all 3 per side" />
              </section>
            </>
          )}

          {/* Comparisons */}
          {section === "comparisons" && (
            <>
              <div className={comparisonControlsEnabled ? "" : "opacity-50 pointer-events-none"}>
                <ControlsBar
                  method={method}
                  onMethodChange={comparisonControlsEnabled ? setMethod : () => {}}
                  bins={bins}
                  onBinsChange={comparisonControlsEnabled ? setBins : () => {}}
                  gridSize={gridSize}
                  onGridSizeChange={comparisonControlsEnabled ? setGridSize : () => {}}
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
                    disabled={!readyToRun || !comparisonControlsEnabled}
                    aria-disabled={!readyToRun || !comparisonControlsEnabled}
                    className={
                      "rounded-xl px-4 py-2 transition " +
                      (readyToRun && comparisonControlsEnabled
                        ? "bg-[#7C3AED] text-white hover:bg-[#6D28D9] shadow"
                        : "bg-neutral-200 text-neutral-500 cursor-not-allowed")
                    }
                  >
                    {busyRun ? "Running…" : "Run Comparison"}
                  </button>
                  {runError && <span style={{ color: "#c00" }}>{runError}</span>}
                </motion.div>
              </div>
              <section className="mt-8">
                <h2 className="text-lg font-semibold mb-3">3D Plot</h2>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  id="plot-viewport"
                  ref={plotRef}
                  className="h-[460px] w-full rounded-3xl border border-neutral-200 bg-[#F9FAFB] shadow-md grid place-items-center text-center p-0"
                >
                  {!runId && (
                    <div className="text-neutral-500 text-sm px-8 text-center">
                      Your 3D visual will appear here after you click <span className="font-medium text-[#F59E0B]">Run Comparison</span>.
                    </div>
                  )}
                </motion.div>
              </section>
              {runId && (
                <div style={{ marginTop: 16 }}>
                  <ComparisonHeatmap
                    runId={runId}
                    apiBase="/api"
                    method={(method ?? "max") as "max" | "mean" | "median" | "chi2"}
                    thresholdMode="quantile"
                    thresholdValue={0.9}
                    width={900}
                    cellSizePx={10}
                  />
                </div>
              )}
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
        aria-label="Upload .zip file"
      >
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[#7C3AED]/10 grid place-items-center text-[#7C3AED]"><Upload className="h-6 w-6" /></div>
          <p className="text-sm font-semibold">Drag & drop a .zip here, or <span className="underline text-[#7C3AED]">browse</span></p>
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-neutral-600"><Badge><FileArchive className="h-3.5 w-3.5" /> .zip only</Badge></div>
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
            <li className="py-3 text-xs text-neutral-500">Listing…</li>
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

/* Controls Bar */
type ControlsBarProps = {
  method: null | "max" | "mean" | "median" | "chi2";
  onMethodChange: (m: null | "max" | "mean" | "median" | "chi2") => void;
  bins: number;
  onBinsChange: (n: number) => void;
  gridSize: number | null;
  onGridSizeChange: (n: number | null) => void;
};

const METHOD_OPTIONS: Array<{ label: string; value: "max" | "mean" | "median" | "chi2" }> = [
  { label: "max", value: "max" },
  { label: "mean", value: "mean" },
  { label: "median", value: "median" },
  { label: "chi²", value: "chi2" },
];

function ControlsBar({ method, onMethodChange, bins, onBinsChange, gridSize, onGridSizeChange }: ControlsBarProps) {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIdx = method ? METHOD_OPTIONS.findIndex((o) => o.value === method) : -1;

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const current = selectedIdx >= 0 ? selectedIdx : 0;
      let next = (current + dir + METHOD_OPTIONS.length) % METHOD_OPTIONS.length;
      tabRefs.current[next]?.focus();
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (selectedIdx >= 0) onMethodChange(METHOD_OPTIONS[selectedIdx].value);
    }
  }

  const minGrid = 100, maxGrid = 900, stepGrid = 100;

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
                  ref={(el) => { tabRefs.current[idx] = el; }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-pressed={active}
                  tabIndex={active || method === null ? 0 : -1}
                  onClick={() => onMethodChange(opt.value)}
                  onKeyDown={handleTabKeyDown}
                  className={
                    "px-3 py-1.5 h-9 rounded-xl text-sm font-medium transition " +
                    (active
                      ? "bg-[#7C3AED]/10 text-[#7C3AED] ring-2 ring-[#7C3AED] ring-offset-2 border border-[#7C3AED]"
                      : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
            {method === "chi2" && (
              <div className="flex items-center ml-3">
                <label htmlFor="chi2-bins" className="text-sm font-medium text-[#7C3AED] mr-2">Bins</label>
                <input
                  id="chi2-bins"
                  type="number"
                  min={2}
                  value={bins}
                  onChange={(e) => onBinsChange(Number(e.target.value))}
                  className="h-9 w-16 rounded-lg border border-neutral-300 px-2 text-sm font-medium text-[#7C3AED] focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 outline-none"
                  aria-label="Number of bins"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full md:justify-end">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <label htmlFor="grid-size-slider" className="text-sm font-medium text-neutral-700 mb-1">Grid Cell Size</label>
            <div className="flex items-center gap-3">
              <input
                id="grid-size-slider"
                type="range"
                min={minGrid}
                max={maxGrid}
                step={stepGrid}
                value={gridSize ?? minGrid}
                onChange={(e) => onGridSizeChange(Number(e.target.value))}
                className="h-2 w-32 md:w-40 accent-[#7C3AED] rounded-lg border border-neutral-300 focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2"
                aria-valuenow={gridSize ?? minGrid}
                aria-valuemin={minGrid}
                aria-valuemax={maxGrid}
                aria-label="Grid cell size in meters"
              />
              <input
                type="number"
                min={minGrid}
                max={maxGrid}
                step={stepGrid}
                value={gridSize ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { onGridSizeChange(null); return; }
                  let v = Number(raw);
                  if (isNaN(v)) return;
                  v = Math.max(minGrid, Math.min(maxGrid, Math.round(v / stepGrid) * stepGrid));
                  onGridSizeChange(v);
                }}
                placeholder={`${minGrid}-${maxGrid}`}
                className="h-9 w-24 rounded-lg border border-neutral-300 px-2 text-sm font-medium text-[#7C3AED] focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 outline-none"
                aria-label="Grid cell size in meters"
              />
              <span className="text-sm text-neutral-700 font-medium">{gridSize !== null ? `${gridSize} m` : "-- m"}</span>
            </div>
            <span className="text-xs text-neutral-500 mt-1">{gridSize !== null ? `≈ ${(gridSize * gridSize / 1_000_000).toFixed(2)} km²` : "Select a value"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Mapping Form */
function MappingForm({ title, columns, mapping, onChange }: { title: string; columns: string[]; mapping: ColumnMapping; onChange: (next: ColumnMapping) => void; }) {
  const setField = (key: RequiredFieldKey, value: string) => onChange({ ...mapping, [key]: value || undefined });
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
                <option value="">—</option>
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
