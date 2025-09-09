import React from 'react'
import ReactDOM from 'react-dom/client'
import ESRI3DComparisonApp from './ESRI3DComparisonApp'
import './index.css'   // ✅ make sure Tailwind CSS is imported

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ESRI3DComparisonApp />
  </React.StrictMode>,
)

