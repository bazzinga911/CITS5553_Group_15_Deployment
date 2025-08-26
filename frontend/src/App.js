import React, { useState } from "react";
import "./App.css";
import background from "./bg.jpg";

function App() {
  const [activePage, setActivePage] = useState("home");
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);

  // Reset everything
  const handleReset = () => {
    setFile1(null);
    setFile2(null);
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
              defining critical resource deposits. The earliest phase of
              exploration seeks to identify regions which likely contain
              precious minerals at economic scale. Typical indicators include:
              High-grade drillhole intercepts which are open along strike or at
              depth; The presence of ‘partner minerals’ which correlate with the
              presence of the mineral of interest; Economic-level interpolated
              or imputed values which are yet untested by real sampling. Early
              explorations are further supported and enhanced by
              government-hosted public datasets of exploration drillhole
              records.
            </p>
          </>
        )}

        {activePage === "about" && (
          <>
            <h2>About The Project</h2>
            <p>
              This project focuses on Tellurium (Te) assay values within a subset
              of this publicly hosted data. Tellurium is a critical
              mineral/metal of high significance globally and recently
              identified as a key pathfinder element for gold exploration in WA.
              A recent study generated a derived dataset containing imputed
              values for samples where Te was not originally analysed. The
              imputed values introduce new information that could guide
              exploration decisions, particularly in identifying prospective
              zones where Te may have been missed during the initial sampling
              phase.
        
              The primary objective of the project is to provide a platform which
              allows an explorer to easily compare the original laboratory assay
              results with the imputed values and quickly identify areas with
              significant deviation between the datasets which may indicate
              prospective but unexplored regions. Within a typical environment,
              at full scale of the data, differences between the original and
              imputed datasets are not easily visualised or interpreted using
              traditional methods. This project will trial data analysis and
              visualisation techniques to detect patterns and highlight zones of
              divergence between datasets. A combination of exploratory data
              analysis, geostatistical comparisons, and visualisation tools will
              aim to reveal “hidden” exploration targets that would otherwise be
              overlooked by the human eye.
    
              While this proof-of-concept will focus on Te, the broader aim is to
              design a flexible analytical platform that could extend to other
              elements. Users would be able to input their own paired datasets
              (original and imputed) for different elements, allowing for
              scalable and element-agnostic geoscientific analysis. The outcome
              will support smarter targeting decisions in mineral exploration,
              combining machine-aided inference with interactive visual
              interpretation.
            </p>
          </>
        )}

        {activePage === "upload" && (
          <>
            <h2>Upload Your Files</h2>
            <p>
              Please upload <strong>2 files</strong>:
            </p>

            <div>
              <label>
                Choose File 1:
                <input
                  type="file"
                  onChange={(e) => setFile1(e.target.files[0])}
                />
                {file1 && <span> ✅</span>}
              </label>
            </div>

            <div>
              <label>
                Choose File 2:
                <input
                  type="file"
                  onChange={(e) => setFile2(e.target.files[0])}
                />
                {file2 && <span> ✅</span>}
              </label>
            </div>

            <div style={{ marginTop: "15px" }}>
              <button disabled={!file1 || !file2}>Run Comparison</button>
              <button disabled={!file1 || !file2}>Export Cell Points</button>
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
