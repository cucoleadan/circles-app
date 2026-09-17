import { SubstackClient, SubstackApiError } from "unofficial-substack-sdk"

export interface SubstackClientOptions {
  sessionToken: string
  publicationUrl?: string | null
}

export function createSubstackClient(options: SubstackClientOptions): SubstackClient {
  const token = options.sessionToken.trim()
  if (!token) {
    throw new Error("Substack session token is required")
  }

  return new SubstackClient({
    sessionToken: token,
    publicationUrl: options.publicationUrl || undefined,
  })
}

export { SubstackClient, SubstackApiError }
