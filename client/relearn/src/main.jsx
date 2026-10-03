import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Lenis from 'lenis'
import App from './App.jsx'
import './tokens.css'
import './index.css'

const lenis = new Lenis({ lerp: 0.1 })
const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf) }
requestAnimationFrame(raf)

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
