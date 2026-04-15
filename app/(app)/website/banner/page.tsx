import { getHeroSlides } from "@/lib/actions/hero-slides"
import BannerManager from "./banner-manager"

export default async function BannerPage() {
  const slides = await getHeroSlides()
  return <BannerManager initialSlides={slides} />
}
