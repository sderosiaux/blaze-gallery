import { Hero } from '@/components/Hero'
import { Sharing } from '@/components/Sharing'
import { Story } from '@/components/Story'
import { Footer, TryIt } from '@/components/TryIt'

export default function Home() {
  return (
    <>
      <Hero />
      <Story />
      <Sharing />
      <TryIt />
      <Footer />
    </>
  )
}
