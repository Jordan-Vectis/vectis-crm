export default function WarehousePage() {
  return <ComingSoon title="Warehouse" description="Container and location tracking — manage totes, pallets, and warehouse movements." />
}

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">🔧</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-4">{description}</p>
        <span className="inline-block bg-amber-100 text-amber-700 text-xs font-medium px-3 py-1 rounded-full">
          Coming soon
        </span>
      </div>
    </div>
  )
}
