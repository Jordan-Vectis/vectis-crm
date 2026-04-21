import { signOutAction } from "@/lib/actions/auth"

export default function UserMenu({ name }: { name: string }) {
  return (
    <div className="absolute top-5 right-6 flex items-center gap-3">
      <span className="text-gray-500 text-sm hidden sm:block">{name}</span>
      <form action={signOutAction} className="inline">
        <button type="submit" className="text-sm text-gray-400 hover:text-white transition-colors">
          Sign out
        </button>
      </form>
      <span className="text-gray-700 text-xs">|</span>
      <form action={signOutAction} className="inline">
        <button type="submit" className="text-sm text-gray-400 hover:text-white transition-colors">
          Change user
        </button>
      </form>
    </div>
  )
}
