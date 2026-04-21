// examples/nextjs-app-router/lib/types.ts

export type AppSession = {
  userId: string
  orgId:  string
  role:   "admin" | "member" | "viewer"
}

export type AppServices = {
  db: {
    post:    any
    user:    any
    comment: any
    vote:    any
    auditLog: any
  }
}
