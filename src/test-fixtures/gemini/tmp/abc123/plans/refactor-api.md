# Plan: Refactor API Error Handling

## Objective
Centralize error handling into middleware instead of per-route try/catch.

## Changes
1. Create `errorHandler.ts` middleware
2. Replace try/catch blocks in route handlers with `next(err)`
3. Add typed error classes (NotFoundError, ValidationError)

## Verification
- All existing tests should still pass
- New error responses should include `code` and `message` fields
