import type { StatusCheckDef } from "./types"

import hub from "./checks/hub"
import database from "./checks/database"
import storage from "./checks/storage"
import backup from "./checks/backup"
import gemini from "./checks/gemini"
import claude from "./checks/claude"
import bcApi from "./checks/bc-api"
import bcSync from "./checks/bc-sync"
import itEmail from "./checks/it-email"
import mailboxes from "./checks/mailboxes"
import royalMail from "./checks/royal-mail"
import did from "./checks/did"
import analytics from "./checks/analytics"
import website from "./checks/website"
import ntfy from "./checks/ntfy"

// 🚦 Every service the Status Centre checks, in the order the page shows them.
// One file per service in ./checks, each default-exporting a StatusCheckDef.
// The Bidpath live-bid feed is NOT here: it is checked from the viewer's own
// browser on /admin/status, because office browsers are what actually use it.
export const CHECKS: StatusCheckDef[] = [
  hub, database, storage, backup,
  gemini, claude,
  bcApi, bcSync,
  itEmail, mailboxes,
  royalMail, did, analytics, website, ntfy,
]
