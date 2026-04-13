"use client"

export default function EnvSelector() {
  return (
    <div className="flex items-center gap-3 text-xs">
      <a href="https://vectis-crm-production.up.railway.app" className="text-gray-400 hover:text-white transition-colors">Production</a>
      <a href="https://vectis-staging.up.railway.app" className="text-gray-400 hover:text-white transition-colors">Staging</a>
    </div>
  )
}
