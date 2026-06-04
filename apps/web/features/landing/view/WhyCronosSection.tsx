'use client'

import { Box, CreditCard } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ScrollAnimation } from '@/components/ui/scroll-animation'

const badges = [
  'Base Sepolia',
  'x402',
  'MCP',
  'Smart Accounts',
  'Session Keys',
]

export function WhyCronosSection() {
  return (
    <section className="py-20 lg:py-28">
      <div className="container">
        <ScrollAnimation animation="fade-up">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">
              Why Base Sepolia & x402
            </h2>
          </div>
        </ScrollAnimation>

        <div className="max-w-4xl mx-auto">
          <ScrollAnimation animation="stagger" className="grid gap-8 md:grid-cols-2">
            {/* Built for Base Sepolia */}
            <Card className="group hover:border-primary/50 hover:shadow-lg transition-all duration-300 bg-card/50">
              <CardHeader className="space-y-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary w-fit group-hover:bg-primary/20 transition-colors">
                  <Box className="size-7" />
                </div>
                <CardTitle className="text-xl">Built for Base Sepolia</CardTitle>
                <CardDescription className="text-base leading-relaxed">
                  opus is deployed on Base Sepolia and integrates directly with Base-compatible protocols, enabling agent-driven swaps, data access and on-chain automation.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* x402 by Default */}
            <Card className="group hover:border-primary/50 hover:shadow-lg transition-all duration-300 bg-card/50">
              <CardHeader className="space-y-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary w-fit group-hover:bg-primary/20 transition-colors">
                  <CreditCard className="size-7" />
                </div>
                <CardTitle className="text-xl">x402 by Default</CardTitle>
                <CardDescription className="text-base leading-relaxed">
                  x402 enables APIs and workflows to become programmable, usage-based economic primitives — a perfect fit for autonomous agents and on-chain settlement.
                </CardDescription>
              </CardHeader>
            </Card>
          </ScrollAnimation>

          {/* Badge row */}
          <ScrollAnimation animation="fade-up" delay={300}>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-12">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-sm font-medium text-primary"
                >
                  {badge}
                </span>
              ))}
            </div>
          </ScrollAnimation>
        </div>
      </div>
    </section>
  )
}
