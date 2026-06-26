import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — RexWare" },
      { name: "description", content: "RexWare Terms of Service." },
    ],
  }),
  component: TermsPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-foreground/90">{title}</h3>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </Link>

      <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: June 9, 2026</p>

      <div className="mt-8 space-y-8">
        <Section title="1. Acceptance of Terms">
          <p>By accessing or using RexWare Services, you agree to be bound by these Terms. If you disagree, you may not access the Service.</p>
          <p>RexWare may update these Terms at any time. Continued use constitutes acceptance.</p>
        </Section>

        <Section title="2. Eligibility">
          <p>You must be at least 18 years old to use our tool as you can't manage cryptos if you are not.</p>
        </Section>

        <Section title="3. Service Description">
          <p>RexWare provides a platform to deploy and manage automated Minecraft bots. RexWare assumes no responsibility for any illegal activities committed in connection with the service.</p>
        </Section>

        <Section title="4. User Accounts">
          <p>Access is via Discord OAuth. You are responsible for your Discord account security and all activities under your account.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Provide accurate information.</li>
            <li>Notify us of security breaches.</li>
            <li>Do not share credentials.</li>
          </ul>
        </Section>

        <Section title="5. Payments & Subscriptions">
          <p>Fees are non-refundable. Subscriptions are monthly; you can cancel anytime from your dashboard.</p>
        </Section>

        <Section title="6. Acceptable Use">
          <p>You agree NOT to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Reverse engineer or bypass security.</li>
            <li>Resell access without permission.</li>
            <li>Distribute malware or harmful content.</li>
          </ul>
        </Section>

        <Section title="7. Termination">
          <p>We may suspend or terminate your account for any breach. Upon termination, your right to use the Service ends immediately.</p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>The Service is provided "AS IS" without warranties. RexWare does not guarantee uninterrupted or error-free operation. You assume all risks of account bans.</p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>To the maximum extent permitted by law, RexWare shall not be liable for indirect, incidental, or consequential damages. Total liability does not exceed amounts paid by you in the last 12 months.</p>
        </Section>
      </div>
    </div>
  );
}
