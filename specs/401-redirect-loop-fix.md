# Bug: ArcSight 401 Redirect Loop — Dashboard Stuck in Loading State

## Bug Description

The dashboard is stuck in an infinite loading state. The server logs show a repeating cycle every few seconds:
```
GET /api/arcsight/connectors/health 401 in 5-6ms
GET /api/auth/session 200
GET /dashboard 200
```

The 401 comes back in 5-6ms — far too fast for a real ArcSight network call. This means the 401 is generated locally by `requireAuth()` before any ArcSight API call is made. The dashboard shows persistent loading skeletons because each redirect cycle remounts the component.

**Expected**: When ArcSight tokens expire, the system should auto-refresh them using stored credentials and continue serving data.

**Actual**: The system throws 401 immediately, the hook redirects to `/`, middleware redirects back to `/dashboard`, and the cycle repeats infinitely.

## Problem Statement

`withAuthRetry()` calls `requireAuth()` **outside** its try-catch block, so when `requireAuth()` throws (session TTL expired), the token refresh logic is never invoked. Combined with a middleware redirect loop, this creates an infinite 401 cycle.

## Solution Statement

1. **Move `requireAuth()` inside the try-catch** in `withAuthRetry()` so that session TTL expiry triggers auto-refresh using stored credentials
2. **Stop polling on 401** in `useArcsightQuery()` to prevent rapid-fire requests during auth failures
3. **Clear cookie before redirect** in the hook so the middleware doesn't redirect back to `/dashboard`

## Steps to Reproduce

1. Log in to the dashboard (creates `esm_session` cookie with ArcSight tokens)
2. Wait for ArcSight REST token to expire (or for session TTL > 23 hours), OR restart the ESM server to invalidate all tokens
3. Observe the server logs: `/api/arcsight/connectors/health` returns 401 in ~5ms repeatedly
4. Dashboard shows loading skeletons indefinitely

## Root Cause Analysis

Three issues combine to create the infinite loop:

### Issue 1: `withAuthRetry()` doesn't retry on `requireAuth()` failure

In `session.ts:204-220`:
```typescript
export async function withAuthRetry<T>(fn) {
  const auth = await requireAuth();  // ← OUTSIDE try-catch — throws AuthError
  try {
    const data = await fn(auth);     // ← Only THIS is retried on 401
    return { data };
  } catch (error) {
    if (!isTokenExpiredError(error)) throw error;
    const { auth: newAuth, cookieHeader } = await refreshSession();
    const data = await fn(newAuth);
    return { data, cookieHeader };
  }
}
```

When `requireAuth()` throws (TTL expired at line 122-124), the error propagates directly to the route handler, which returns 401. The `refreshSession()` at line 216 is never called.

`refreshSession()` (line 149-200) CAN recover from this — it calls `getSession()` which doesn't check TTL, gets the stored username/password, and re-logins. But it's never given the chance.

### Issue 2: Hook keeps polling and creates redirect loop

In `use-arcsight.ts:81-83`:
```typescript
if (res.status === 401) {
  window.location.href = "/";  // Redirects, but doesn't stop polling
  throw new Error("Session expired");
}
```

The `setInterval` polling (line 117-120) continues firing even after 401. And critically, the `esm_session` cookie still exists (it's valid, just TTL-expired), so middleware (line 9) redirects `/` → `/dashboard`, restarting the cycle.

### Issue 3: Middleware checks cookie existence, not validity

In `middleware.ts:4,9`:
```typescript
const hasSession = request.cookies.has("esm_session");
if (hasSession && request.nextUrl.pathname === "/") {
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
```

The cookie exists but contains expired tokens. Middleware sees it and redirects back to dashboard.

## Relevant Files

Use these files to fix the bug:

- **`frontend/src/lib/session.ts`** — Contains `withAuthRetry()` (the primary fix site at lines 204-220), `requireAuth()` (lines 117-131), `refreshSession()` (lines 149-200), `isTokenExpiredError()` (lines 135-142), and `AuthError` class (lines 19-24). This is where the core bug lives — `requireAuth()` is called outside the try-catch.
- **`frontend/src/hooks/use-arcsight.ts`** — Contains `useArcsightQuery()` (lines 44-125) where 401 handling (line 81-84) and polling interval logic (lines 115-121) lives. The hook doesn't stop polling on 401 and doesn't clear the session cookie before redirecting.
- **`frontend/src/app/api/arcsight/connectors/health/route.ts`** — The specific route producing 401s. Representative of all routes using `withAuthRetry` + `AuthError` catch pattern. No changes needed here — the fix is in the shared `session.ts`.
- **`frontend/src/middleware.ts`** — Cookie-existence check (line 4, 9) that enables the redirect loop. No changes needed — the hook fix (clearing cookie before redirect) breaks the loop.

## Step by Step Tasks

### Step 1: Fix `withAuthRetry()` to attempt refresh on `requireAuth()` failure

**File**: `frontend/src/lib/session.ts` (lines 204-220)

- Move `requireAuth()` inside the try block so that `AuthError` from TTL expiry is caught
- In the catch block, check for `AuthError` in addition to `isTokenExpiredError()`
- Attempt `refreshSession()` — if it succeeds, retry `fn()` with new tokens
- If refresh fails (no stored credentials, ArcSight unreachable), re-throw `AuthError` so the route returns 401

Replace `withAuthRetry()` with:
```typescript
export async function withAuthRetry<T>(
  fn: (auth: SessionAuth) => Promise<T>
): Promise<{ data: T; cookieHeader?: string }> {
  try {
    const auth = await requireAuth();
    const data = await fn(auth);
    return { data };
  } catch (error) {
    // Retry on: session TTL expired (AuthError) OR ArcSight token rejected (401/Unauthorized)
    if (!(error instanceof AuthError) && !isTokenExpiredError(error)) throw error;

    console.log("[session] Auth failed, attempting token refresh...");
    try {
      const { auth: newAuth, cookieHeader } = await refreshSession();
      const data = await fn(newAuth);
      return { data, cookieHeader };
    } catch (refreshError) {
      // Refresh failed — throw AuthError so route returns 401
      if (refreshError instanceof AuthError) throw refreshError;
      throw new AuthError("Token refresh failed");
    }
  }
}
```

### Step 2: Stop polling on 401 and clear cookie before redirect

**File**: `frontend/src/hooks/use-arcsight.ts` (lines 44-125)

- Add an `authFailedRef` to track when 401 is detected
- When 401 is received, set `authFailedRef.current = true` before redirecting
- In the polling `setInterval`, check `authFailedRef.current` and skip the poll if true
- Before redirecting, call `fetch("/api/auth/logout", { method: "POST" })` to clear the `esm_session` cookie so middleware doesn't redirect back to `/dashboard`

Changes:

1. Add ref after `fetchingRef` (line 53):
   ```typescript
   const authFailedRef = useRef(false);
   ```

2. Replace the 401 handler (lines 81-84) with:
   ```typescript
   if (res.status === 401) {
     authFailedRef.current = true;
     // Clear session cookie so middleware won't redirect back to /dashboard
     fetch("/api/auth/logout", { method: "POST" })
       .catch(() => {})
       .finally(() => { window.location.href = "/"; });
     throw new Error("Session expired");
   }
   ```

3. Update polling interval condition (line 118) from:
   ```typescript
   if (!fetchingRef.current) refetch();
   ```
   to:
   ```typescript
   if (!fetchingRef.current && !authFailedRef.current) refetch();
   ```

### Step 3: Validate the fix

- Run `npm run build` to confirm no TypeScript errors
- Run `npm test` to confirm no test regressions

## Validation Commands

- `cd frontend && npm run build` — Verify no TypeScript or build errors
- `cd frontend && npm test` — Run unit tests to confirm no regressions

## Notes

- The `refreshSession()` function already handles concurrent refresh deduplication via `refreshPromise` (line 147), so multiple hooks hitting 401 simultaneously will share a single refresh call
- The `esm_session` cookie is `HttpOnly`, so it cannot be cleared from client JavaScript — that's why we call `/api/auth/logout` (POST) before redirecting
- The server cache (`createServerCache`) only caches successful results, so a cached 401 is not possible
- Fix 1 (server-side refresh) is the primary fix that prevents 401 from reaching the client. Fix 2 (hook safety net) is a defense-in-depth measure for when refresh truly fails
- Only 2 files need changes: `session.ts` and `use-arcsight.ts` — all 30 route handlers benefit automatically since they all use `withAuthRetry()`
