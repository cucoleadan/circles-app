import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"

const faqs = [
  {
    q: "Is Circles made by Substack?",
    a: "No. Circles is an independent, unofficial open-source project. It reads Substack through an unofficial API client using your own browser session, so automated access may conflict with Substack's terms. Use it for your own account, at your own risk.",
  },
  {
    q: "Where does my data live?",
    a: "On your server. You run Circles with Docker Compose next to your own PostgreSQL database. Every tenant table uses row-level security, the runtime uses a restricted database role, and your Substack session is encrypted at rest when SESSION_TOKEN_KEY is set.",
  },
  {
    q: "What does the Chrome extension access?",
    a: "Substack, plus the single Circles server you pair in its popup. Chrome asks for permission for that one site. The extension connects your Substack session and records your own likes, restacks, comments and replies when they succeed. It doesn't make extra Substack requests just because you're browsing.",
  },
  {
    q: "Can it recover my full history?",
    a: "Partly. Circles backfills your Notes, posts and their reply threads, plus the active Likes, restacks and replies your profile feeds still return. Actions you undid in the past may no longer be available from Substack, so Circles labels that coverage as partial instead of claiming it's complete.",
  },
  {
    q: "Does Circles post on my behalf?",
    a: "Only when you schedule a Note. It saves the Note as a Substack draft with a publish time, and Substack itself publishes it. Circles runs no publishing job of its own.",
  },
  {
    q: "Can I use it with AI agents?",
    a: "Yes. Circles includes an OAuth-protected MCP server at /api/mcp. You choose what each agent can do when you approve it, and you can revoke access at any time from the MCP page.",
  },
]

export function LandingFaq() {
  return (
    <Accordion type="single" collapsible className="rounded-lg border bg-card px-5">
      {faqs.map(({ q, a }) => (
        <AccordionItem key={q} value={q}>
          <AccordionTrigger className="text-base">{q}</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
