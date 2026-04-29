"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type ErrorState = {
  open:    boolean
  title:   string
  message: string
  detail?: string
}

type ShowErrorFn = (title: string, message: string, detail?: string) => void

// ─── Context ──────────────────────────────────────────────────────────────────

const ErrorModalContext = createContext<ShowErrorFn>(() => {})

export function useErrorModal(): ShowErrorFn {
  return useContext(ErrorModalContext)
}

// ─── Global helper (works outside React — e.g. fetch utils, API wrappers) ────

export function showError(title: string, message: string, detail?: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent("vectis-error", { detail: { title, message, detail } })
  )
}

// ─── Provider + Modal ─────────────────────────────────────────────────────────

export function ErrorModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ErrorState>({
    open: false, title: "", message: "",
  })
  const [copied, setCopied] = useState(false)

  const show = useCallback<ShowErrorFn>((title, message, detail) => {
    setState({ open: true, title, message, detail })
    setCopied(false)
  }, [])

  // Listen for window events so non-React code can trigger the modal
  useEffect(() => {
    const handler = (e: Event) => {
      const { title, message, detail } = (e as CustomEvent<{ title: string; message: string; detail?: string }>).detail
      show(title, message, detail)
    }
    window.addEventListener("vectis-error", handler)
    return () => window.removeEventListener("vectis-error", handler)
  }, [show])

  const close = useCallback(() => setState(s => ({ ...s, open: false })), [])

  function copyError() {
    const text = [state.title, state.message, state.detail].filter(Boolean).join("\n\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Close on Escape
  useEffect(() => {
    if (!state.open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [state.open, close])

  return (
    <ErrorModalContext.Provider value={show}>
      {children}

      {state.open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={close}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

          {/* Modal */}
          <div
            className="relative bg-[#1C1C1E] border border-red-800/50 rounded-2xl shadow-2xl w-full max-w-lg"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-4 px-5 py-5 border-b border-gray-800">
              <div className="w-9 h-9 rounded-full bg-red-950 border border-red-700/60 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 className="text-white font-semibold text-base leading-tight">{state.title}</h2>
                <p className="text-gray-400 text-sm mt-1 leading-relaxed">{state.message}</p>
              </div>
              <button
                onClick={close}
                className="text-gray-600 hover:text-gray-300 transition-colors mt-0.5 flex-shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Detail block */}
            {state.detail && (
              <div className="px-5 py-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                  Error detail
                </p>
                <pre className="bg-black/60 border border-gray-800 rounded-xl px-4 py-3 text-xs text-gray-300 whitespace-pre-wrap overflow-auto max-h-52 font-mono leading-relaxed">
                  {state.detail}
                </pre>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-800">
              <p className="text-[11px] text-gray-600 flex-1">
                Press <kbd className="bg-gray-800 text-gray-400 px-1 py-0.5 rounded text-[10px] font-mono">Esc</kbd> or click outside to dismiss
              </p>
              <button
                onClick={copyError}
                className="text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
              >
                {copied ? "✓ Copied" : "Copy error"}
              </button>
              <button
                onClick={close}
                className="text-xs bg-red-900/70 hover:bg-red-800/80 border border-red-800/60 text-white px-4 py-1.5 rounded-lg transition-colors font-medium"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorModalContext.Provider>
  )
}
