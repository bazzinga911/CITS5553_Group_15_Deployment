import React, { useState } from "react";
import "./App.css";
import background from "./bg.jpg";

function App() {
  const [activePage, setActivePage] = useState("home");
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);

  const handleReset = () => {
    setFile1(null);
    setFile2(null);
  };

  const runComparison = async () => {
    try {
      if (!file1 || !file2) return;
      const form = new FormData();
      form.append("files", file1);
      form.append("files", file2);
      const res = await fetch("http://127.0.0.1:5000/run-comparison", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      console.log("Run Comparison response:", data);
    } catch (e) {
      console.error("Run Comparison failed:", e);
    }
  };

  const exportCellPoints = () => {
    window.location.href = "http://127.0.0.1:5000/export/comp-grid.csv";
  };

  return (
    <div
      className="app"
      style={{
        backgroundImage: `url(${background})`,
      }}
    >
      {/* Header */}
      <div className="header">
        <div className="left">
          <button
            className={activePage === "home" ? "active" : ""}
            onClick={() => setActivePage("home")}
          >
            Home
          </button>
          <button
            className={activePage === "about" ? "active" : ""}
            onClick={() => setActivePage("about")}
          >
            About
          </button>
        </div>

        <div className="right">
          <button
            className={activePage === "upload" ? "active" : ""}
            onClick={() => setActivePage("upload")}
          >
            Upload
          </button>
          <button onClick={handleReset}>Reset</button>
        </div>
      </div>

      {/* Content */}
      <div className={`content ${activePage}`}>
        {activePage === "home" && (
          <>
            <h1>WELCOME</h1>
            <p>
              Mineral exploration in Western Australia is a critical activity
              that supports the greater mining industry by discovering and
              defining critical resource deposits...
            </p>
          </>
        )}

        {activePage === "about" && (
          <>
            <h2>About The Project</h2>
            <p>
              This project focuses on Tellurium (Te) assay values...
            </p>
          </>
        )}

        {activePage === "upload" && (
          <>
            <h2>Upload Your Files</h2>
            <p>Please upload <strong>2 files</strong>:</p>

            <div>
              <label>
                Original GeoParquet:{" "}
                <input
                  type="file"
                  accept=".parquet,.geoparquet"
                  onChange={(e) => setFile1(e.target.files[0])}
                />
                {file1 && <span> ✅</span>}
              </label>
            </div>

            <div style={{ marginTop: "10px" }}>
              <label>
                Imputed (DL) GeoParquet:{" "}
                <input
                  type="file"
                  accept=".parquet,.geoparquet"
                  onChange={(e) => setFile2(e.target.files[0])}
                />
                {file2 && <span> ✅</span>}
              </label>
            </div>

            <div style={{ marginTop: "15px" }}>
              <button disabled={!file1 || !file2} onClick={runComparison}>
                Run Comparison
              </button>
              <button onClick={exportCellPoints}>
                Export Cell Points
              </button>
              <button onClick={handleReset}>Reset</button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        © Group15 Capstone Project | All rights reserved
      </div>
    </div>
  );
}

export default App;
