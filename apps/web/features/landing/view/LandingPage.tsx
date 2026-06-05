import { HeroSection } from './HeroSection'
import { ProblemSection } from './ProblemSection'
import { SolutionSection } from './SolutionSection'
import { HowItWorksSection } from './HowItWorksSection'
import { WhyBaseSection } from './WhyBaseSection'
import { AudienceSection } from './AudienceSection'
import { CtaSection } from './CtaSection'
import { Footer } from './Footer'

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <HeroSection />
      <ProblemSection />
      <SolutionSection />
      <HowItWorksSection />
      <WhyBaseSection />
      <AudienceSection />
      <CtaSection />
      <Footer />
    </div>
  )
}
