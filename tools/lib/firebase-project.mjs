export const projectId = "lifesaving-baden";

// Used only by trusted maintenance CLIs, never by the public website.
export function readServiceAccount(environment = process.env) {
  const value = environment.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");
  let account;
  try { account = JSON.parse(value); }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."); }
  if (!account || account.project_id !== projectId) {
    throw new Error("Unexpected Firebase project; refusing to access the database.");
  }
  return account;
}
