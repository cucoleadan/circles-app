export type V1Env = {
  Variables: {
    appUser: string
    mcpScopes?: ReadonlySet<string>
    mcpDraftOnly?: boolean
  }
}
